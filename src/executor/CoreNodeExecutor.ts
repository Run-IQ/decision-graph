import type { ExecutionMeta } from '@run-iq/context-engine';
import type { PPEEngine, Rule, EvaluationInput } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { NodeExecutor, NodeResult } from './NodeExecutor.js';
import type { RuleResolver } from '../resolver/RuleResolver.js';
import { DGMissingOutputError } from '../errors.js';

export class CoreNodeExecutor implements NodeExecutor {
  constructor(
    private readonly engine: PPEEngine,
    private readonly resolver: RuleResolver,
  ) {}

  async execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult> {
    const rules = await this.resolver.resolve(node, meta);

    // Adaptation #4: effectiveDate string→Date conversion
    const effectiveDate = meta.effectiveDate ? new Date(meta.effectiveDate) : undefined;

    const evalInput: EvaluationInput = {
      data: { ...inputs },
      requestId: `${meta.requestId}:${node.id}`,
      meta: {
        tenantId: meta.tenantId,
        ...(meta.userId !== undefined ? { userId: meta.userId } : {}),
        ...(meta.context !== undefined ? { context: meta.context } : {}),
        ...(effectiveDate !== undefined ? { effectiveDate } : {}),
      },
    };

    const start = Date.now();
    // Adaptation #1: engine.evaluate(rules, input) — 2 args
    const result = await this.engine.evaluate(rules as ReadonlyArray<Rule>, evalInput);
    const durationMs = Date.now() - start;

    // Extract outputs by port mapping
    const outputs = this.extractPortValues(node, result);

    return {
      outputs,
      raw: result,
      durationMs,
    };
  }

  private extractPortValues(
    node: DGNode,
    result: {
      value: unknown;
      breakdown: unknown;
      trace: unknown;
      appliedRules: unknown;
      meta?: Record<string, unknown> | undefined;
    },
  ): Record<string, unknown> {
    const outputs: Record<string, unknown> = {};

    for (const port of node.ports.out) {
      let value: unknown;

      // Map well-known port names to result fields
      if (port.name === 'value') {
        value = result.value;
      } else if (port.name === 'breakdown') {
        value = result.breakdown;
      } else if (port.name === 'trace') {
        value = result.trace;
      } else if (port.name === 'applied') {
        value = result.appliedRules;
      } else {
        // Adaptation #2: no pluginData — use result.meta?.[port.name]
        value = result.meta?.[port.name];
      }

      if (value === undefined && port.required) {
        throw new DGMissingOutputError(
          `Node "${node.id}": required output port "${port.name}" produced no value`,
          node.id,
          port.name,
        );
      }

      if (value !== undefined) {
        outputs[port.name] = value;
      }
    }

    return outputs;
  }
}
