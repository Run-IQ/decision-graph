import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { MergeNodeConfig } from '../types/policy.js';
import type { CompiledGraph } from '../types/compiled.js';
import type { NodeExecutor } from '../executor/NodeExecutor.js';
import type { DGContext } from '../context/DGContext.js';
import { DGMergeError } from '../errors.js';
import { extractInputs, injectOutputs } from './nodeRunner.js';
import { handleNodeError } from './errorHandler.js';
import { now } from '../utils.js';

function getActiveParents(
  nodeId: string,
  compiled: CompiledGraph,
  ctx: DGContext,
): { completed: string[]; active: string[] } {
  const parents: string[] = [];
  for (const edge of compiled.source.edges) {
    if (edge.to.node === nodeId) {
      parents.push(edge.from.node);
    }
  }

  const completed: string[] = [];
  const active: string[] = [];

  for (const parentId of parents) {
    if (ctx.isSkipped(parentId) || ctx.isFailed(parentId)) {
      // Not active
      continue;
    }
    active.push(parentId);
    if (ctx.isCompleted(parentId)) {
      completed.push(parentId);
    }
  }

  return { completed, active };
}

export async function runMerge(
  node: DGNode,
  compiled: CompiledGraph,
  ctx: DGContext,
  executor: NodeExecutor,
  meta: ExecutionMeta,
): Promise<void> {
  const mergeConfig = (node.meta?.['mergeConfig'] as MergeNodeConfig | undefined) ?? {
    strategy: 'wait-all' as const,
    onPartialInputs: 'fail' as const,
  };

  const { completed, active } = getActiveParents(node.id, compiled, ctx);
  const quorumMet = checkQuorum(mergeConfig, completed, active, node.id);

  if (!quorumMet) {
    // Handle partial inputs
    if (mergeConfig.onPartialInputs === 'fail') {
      const err = new DGMergeError(
        `Merge node "${node.id}": quorum not met (${completed.length}/${active.length} active parents completed)`,
        node.id,
      );
      handleNodeError(node, err, compiled, ctx);
      return;
    }

    if (mergeConfig.onPartialInputs === 'use-defaults') {
      // Use port defaults — extractInputs will handle this
    }
    // 'proceed-with-available' — just proceed with what we have
  }

  // Emit waiting event
  ctx.emit({
    type: 'merge.waiting',
    nodeId: node.id,
    strategy: mergeConfig.strategy,
    waiting: active.filter((p) => !completed.includes(p)),
    received: completed,
    ts: now(),
  });

  // If merge has a model, execute it; otherwise pass-through
  if (node.model) {
    const nodeExecutionId = `${meta.requestId}:${node.id}`;
    try {
      const inputs = extractInputs(node, compiled.wiring, ctx);
      ctx.emit({
        type: 'node.started',
        nodeId: node.id,
        nodeExecutionId,
        inputs,
        ts: now(),
      });

      const result = await executor.execute(node, inputs, meta);
      injectOutputs(node, result.outputs, ctx);

      if (node.policy.storeRaw === true && result.raw !== undefined) {
        ctx.setRaw(node.id, result.raw);
      }

      ctx.markCompleted(node.id);
      ctx.emit({
        type: 'node.completed',
        nodeId: node.id,
        nodeExecutionId,
        outputs: result.outputs,
        durationMs: result.durationMs,
        ts: now(),
      });
    } catch (err) {
      handleNodeError(node, err instanceof Error ? err : new Error(String(err)), compiled, ctx);
    }
  } else {
    // Pass-through merge — collect parent outputs and mark completed
    ctx.markCompleted(node.id);
    ctx.emit({
      type: 'node.completed',
      nodeId: node.id,
      nodeExecutionId: `${meta.requestId}:${node.id}`,
      outputs: {},
      durationMs: 0,
      ts: now(),
    });
  }
}

function checkQuorum(
  config: MergeNodeConfig,
  completed: string[],
  active: string[],
  _nodeId: string,
): boolean {
  switch (config.strategy) {
    case 'wait-all':
      return completed.length >= active.length;
    case 'wait-any':
      return completed.length >= 1;
    case 'wait-quorum': {
      const quorum = config.quorum ?? active.length;
      return completed.length >= quorum;
    }
  }
}
