import type { DSLEvaluator } from '@run-iq/core';
import type { ExecutionMeta, PersistenceAdapter } from '@run-iq/context-engine';
import type { CompiledGraph } from '../types/compiled.js';
import type { DGStatus, LogLevel } from '../types/events.js';
import type { DGResult } from '../types/result.js';
import type { ExecutionLimits } from '../types/policy.js';
import type { NodeExecutor } from '../executor/NodeExecutor.js';
import type { DGLifecycleHooks } from './hooks.js';
import { DGContext, type DGContextOptions } from '../context/DGContext.js';
import { DEFAULT_LIMITS } from '../types/policy.js';
import { DGHaltError, DGTimeoutError } from '../errors.js';
import { resolveActiveNodes } from './edgeResolver.js';
import { runNode } from './nodeRunner.js';
import { runMerge } from './mergeRunner.js';
import { handleNodeError } from './errorHandler.js';
import { parallelWithLimit } from './parallelWithLimit.js';
import { now, withTimeout } from '../utils.js';
import { EventEmitter } from 'node:events';

export interface DGOrchestratorOptions {
  logLevel?: LogLevel;
  streaming?: EventEmitter;
  limits?: ExecutionLimits;
  hooks?: DGLifecycleHooks;
  adapter?: PersistenceAdapter;
}

export class DGOrchestrator {
  private readonly executor: NodeExecutor;
  private readonly dsls: Map<string, DSLEvaluator>;
  private readonly options: DGOrchestratorOptions;

  constructor(
    executor: NodeExecutor,
    dsls: Map<string, DSLEvaluator>,
    options?: DGOrchestratorOptions,
  ) {
    this.executor = executor;
    this.dsls = dsls;
    this.options = options ?? {};
  }

  async execute(
    compiled: CompiledGraph,
    input: Record<string, unknown>,
    meta: ExecutionMeta,
  ): Promise<DGResult> {
    const limits = { ...DEFAULT_LIMITS, ...this.options.limits };
    const maxDurationMs = limits.maxDurationMs;
    const maxParallel = limits.maxParallelNodes;

    // Build DGContext options
    let ctxOpts: DGContextOptions = {
      ...(this.options.logLevel !== undefined ? { logLevel: this.options.logLevel } : {}),
      ...(this.options.streaming !== undefined ? { streaming: this.options.streaming } : {}),
      ...(this.options.adapter !== undefined ? { adapter: this.options.adapter } : {}),
      ...(limits.maxEvents !== undefined ? { maxEvents: limits.maxEvents } : {}),
    };

    // Forward context hooks — build opts with hooks included
    if (this.options.hooks?.contextHooks) {
      ctxOpts = { ...ctxOpts, hooks: this.options.hooks.contextHooks };
    }

    const ctx = new DGContext(input, meta, ctxOpts);

    // Start execution in persistence store
    const adapter = this.options.adapter;
    if (adapter?.executions) {
      try {
        await adapter.executions.startExecution({
          executionId: meta.requestId,
          requestId: meta.requestId,
          tenantId: meta.tenantId,
          graphId: compiled.source.id,
          graphHash: compiled.hash,
          graphVersion: compiled.source.version,
          startedAt: new Date().toISOString(),
          status: 'running',
        });
      } catch (err: unknown) {
        this.options.hooks?.onError?.(
          // Synthetic node for adapter errors
          {
            id: '__adapter__',
            type: 'compute',
            model: '',
            ports: { in: [], out: [] },
            policy: { onError: 'fail', onFailPropagation: 'continue' },
          },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    // Lifecycle: beforeGraph
    if (this.options.hooks?.beforeGraph) {
      await this.options.hooks.beforeGraph(compiled, meta);
    }

    const graphStart = Date.now();

    // Emit graph.started
    ctx.emit({
      type: 'graph.started',
      graphId: compiled.source.id,
      hash: compiled.hash,
      requestId: meta.requestId,
      ts: now(),
    });

    let status: DGStatus = 'completed';

    try {
      // Execute with timeout
      const execPromise = this.executeLevels(
        compiled,
        ctx,
        meta,
        maxParallel,
        graphStart,
        maxDurationMs,
      );
      await withTimeout(
        execPromise,
        maxDurationMs,
        `Graph execution exceeded maxDurationMs (${maxDurationMs}ms)`,
      );
    } catch (err: unknown) {
      if (err instanceof DGHaltError) {
        status = 'failed';
      } else if (err instanceof DGTimeoutError) {
        status = 'failed';
      } else {
        status = 'failed';
        throw err;
      }
    }

    // Determine final status: partial if some completed and some failed/skipped
    if (status === 'completed') {
      const hasFailed = ctx.getEvents().some((e) => e.type === 'node.failed');
      const hasSkipped = ctx.getEvents().some((e) => e.type === 'node.skipped');
      if (hasFailed) {
        status = 'partial';
      } else if (hasSkipped) {
        // Skipped due to edge conditions is normal; skipped due to failure propagation is partial
        const hasFailPropagation = ctx
          .getEvents()
          .some((e) => e.type === 'node.skipped' && e.reason === 'parent-failed-propagation');
        if (hasFailPropagation) {
          status = 'partial';
        }
      }
    }

    const durationMs = Date.now() - graphStart;

    // Emit graph.completed
    ctx.emit({
      type: 'graph.completed',
      status,
      durationMs,
      ts: now(),
    });

    const result = ctx.buildResult(compiled);

    // Lifecycle: afterGraph
    if (this.options.hooks?.afterGraph) {
      await this.options.hooks.afterGraph(result);
    }

    // Complete execution in persistence store
    if (adapter?.executions) {
      try {
        await adapter.executions.completeExecution(meta.requestId, {
          status,
          completedAt: new Date().toISOString(),
          durationMs,
          executed: result.executed,
          skipped: result.skipped,
          failed: result.failed,
        });
      } catch (err: unknown) {
        this.options.hooks?.onError?.(
          {
            id: '__adapter__',
            type: 'compute',
            model: '',
            ports: { in: [], out: [] },
            policy: { onError: 'fail', onFailPropagation: 'continue' },
          },
          err instanceof Error ? err : new Error(String(err)),
        );
      }
    }

    return result;
  }

  private async executeLevels(
    compiled: CompiledGraph,
    ctx: DGContext,
    meta: ExecutionMeta,
    maxParallel: number,
    graphStart: number,
    maxDurationMs: number,
  ): Promise<void> {
    for (const level of compiled.levels) {
      // Check timeout
      if (Date.now() - graphStart > maxDurationMs) {
        throw new DGTimeoutError(`Graph execution exceeded maxDurationMs (${maxDurationMs}ms)`);
      }

      const levelStart = Date.now();

      // Emit level.started
      ctx.emit({
        type: 'level.started',
        level: level.index,
        nodes: level.nodes,
        mergeNodes: level.mergeNodes,
        ts: now(),
      });

      // 1. Resolve which parallel nodes are active (edge conditions)
      const { active, skipped } = resolveActiveNodes(level.nodes, compiled, ctx, this.dsls);

      // Mark skipped nodes
      for (const nodeId of skipped) {
        ctx.markSkipped(nodeId);
        ctx.emit({
          type: 'node.skipped',
          nodeId,
          reason: 'edge-condition-false',
          ts: now(),
        });
      }

      // 2. Execute parallel nodes with concurrency limit
      const tasks = active.map((nodeId) => async () => {
        const node = compiled.source.nodes[nodeId];
        if (!node) return;

        // Check if already processed
        if (ctx.isCompleted(nodeId) || ctx.isFailed(nodeId) || ctx.isSkipped(nodeId)) return;

        try {
          // Lifecycle: beforeNode
          if (this.options.hooks?.beforeNode) {
            const inputs = {}; // inputs are extracted inside runNode
            await this.options.hooks.beforeNode(node, inputs);
          }

          const result = await runNode(node, compiled.wiring, ctx, this.executor, meta);

          // Lifecycle: afterNode
          if (this.options.hooks?.afterNode) {
            await this.options.hooks.afterNode(node, result);
          }
        } catch (err: unknown) {
          const error = err instanceof Error ? err : new Error(String(err));

          // Lifecycle: onError
          if (this.options.hooks?.onError) {
            await this.options.hooks.onError(node, error);
          }

          handleNodeError(node, error, compiled, ctx);
        }
      });

      await parallelWithLimit(tasks, maxParallel);

      // 3. Execute merge nodes sequentially
      for (const mergeNodeId of level.mergeNodes) {
        const mergeNode = compiled.source.nodes[mergeNodeId];
        if (!mergeNode) continue;

        if (ctx.isCompleted(mergeNodeId) || ctx.isFailed(mergeNodeId) || ctx.isSkipped(mergeNodeId))
          continue;

        try {
          await runMerge(mergeNode, compiled, ctx, this.executor, meta);
        } catch (err: unknown) {
          // DGHaltError propagates up
          if (err instanceof DGHaltError) throw err;

          const error = err instanceof Error ? err : new Error(String(err));
          if (this.options.hooks?.onError) {
            await this.options.hooks.onError(mergeNode, error);
          }
          handleNodeError(mergeNode, error, compiled, ctx);
        }
      }

      // Emit level.completed
      ctx.emit({
        type: 'level.completed',
        level: level.index,
        durationMs: Date.now() - levelStart,
        ts: now(),
      });
    }
  }
}
