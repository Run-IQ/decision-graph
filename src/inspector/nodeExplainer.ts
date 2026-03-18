import type { DGEvent } from '../types/events.js';

export interface NodeExplanation {
  readonly nodeId: string;
  readonly status: 'completed' | 'failed' | 'skipped' | 'not-executed';
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly durationMs?: number;
  readonly inputs?: Readonly<Record<string, unknown>>;
  readonly outputs?: Readonly<Record<string, unknown>>;
  readonly error?: string;
  readonly skipReason?: string;
  readonly fallback?: Readonly<Record<string, unknown>>;
  readonly events: readonly DGEvent[];
}

export function explainNode(nodeId: string, events: readonly DGEvent[]): NodeExplanation {
  const nodeEvents = events.filter((e) => {
    if ('nodeId' in e) return e.nodeId === nodeId;
    return false;
  });

  const started = nodeEvents.find(
    (e): e is Extract<DGEvent, { type: 'node.started' }> => e.type === 'node.started',
  );

  const completed = nodeEvents.find(
    (e): e is Extract<DGEvent, { type: 'node.completed' }> => e.type === 'node.completed',
  );

  const failed = nodeEvents.find(
    (e): e is Extract<DGEvent, { type: 'node.failed' }> => e.type === 'node.failed',
  );

  const skipped = nodeEvents.find(
    (e): e is Extract<DGEvent, { type: 'node.skipped' }> => e.type === 'node.skipped',
  );

  const fallback = nodeEvents.find(
    (e): e is Extract<DGEvent, { type: 'node.fallback' }> => e.type === 'node.fallback',
  );

  let status: NodeExplanation['status'] = 'not-executed';
  if (completed || fallback) status = 'completed';
  else if (failed) status = 'failed';
  else if (skipped) status = 'skipped';

  return {
    nodeId,
    status,
    ...(started ? { startedAt: started.ts, inputs: started.inputs } : {}),
    ...(completed
      ? { completedAt: completed.ts, durationMs: completed.durationMs, outputs: completed.outputs }
      : {}),
    ...(failed ? { error: failed.error } : {}),
    ...(skipped ? { skipReason: skipped.reason } : {}),
    ...(fallback ? { fallback: fallback.fallback } : {}),
    events: nodeEvents,
  };
}
