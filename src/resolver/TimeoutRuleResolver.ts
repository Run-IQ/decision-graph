import type { ExecutionMeta } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';
import { withTimeout } from '../utils.js';

export class TimeoutRuleResolver implements RuleResolver {
  constructor(
    private readonly inner: RuleResolver,
    private readonly timeoutMs: number,
  ) {}

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    return withTimeout(
      this.inner.resolve(node, meta),
      this.timeoutMs,
      `Rule resolution for node "${node.id}" timed out after ${this.timeoutMs}ms`,
    );
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    return this.inner.fingerprint(node, meta);
  }
}
