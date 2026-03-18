import type { DGNode } from '../types/graph.js';
import type { CompiledGraph } from '../types/compiled.js';
import type { DGContext } from '../context/DGContext.js';
import { DGHaltError } from '../errors.js';
import { now } from '../utils.js';

export function handleNodeError(
  node: DGNode,
  err: Error,
  compiled: CompiledGraph,
  ctx: DGContext,
): void {
  const nodeExecutionId = `${ctx['meta'].requestId}:${node.id}` as string;

  if (node.policy.onError === 'fallback' && node.policy.fallback) {
    // Inject fallback values into context
    for (const [portName, value] of Object.entries(node.policy.fallback)) {
      ctx.set(node.id, portName, value);
    }
    ctx.markCompleted(node.id);
    ctx.emit({
      type: 'node.fallback',
      nodeId: node.id,
      fallback: node.policy.fallback,
      ts: now(),
    });
    return;
  }

  if (node.policy.onError === 'skip') {
    ctx.markSkipped(node.id);
    ctx.emit({
      type: 'node.skipped',
      nodeId: node.id,
      reason: 'edge-condition-false',
      ts: now(),
    });
    // Propagation handled below
  } else {
    // onError === 'fail'
    ctx.markFailed(node.id);
    ctx.emit({
      type: 'node.failed',
      nodeId: node.id,
      nodeExecutionId,
      error: err.message,
      propagation: node.policy.onFailPropagation,
      ts: now(),
    });
  }

  // Handle propagation
  const propagation = compiled.failures.get(node.id);
  if (!propagation) return;

  if (propagation.policy === 'halt') {
    throw new DGHaltError(
      `Node "${node.id}" failed with halt propagation: ${err.message}`,
      node.id,
    );
  }

  if (propagation.policy === 'skip-descendants') {
    for (const descendantId of propagation.descendants) {
      if (
        !ctx.isSkipped(descendantId) &&
        !ctx.isFailed(descendantId) &&
        !ctx.isCompleted(descendantId)
      ) {
        ctx.markSkipped(descendantId);
        ctx.emit({
          type: 'node.skipped',
          nodeId: descendantId,
          reason: 'parent-failed-propagation',
          ts: now(),
        });
      }
    }
  }
  // 'continue' → do nothing — descendants use port defaults
}
