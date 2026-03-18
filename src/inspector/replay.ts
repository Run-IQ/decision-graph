import type { DGEvent, DGStatus } from '../types/events.js';

export interface ReplaySnapshot {
  readonly completedNodes: readonly string[];
  readonly failedNodes: readonly string[];
  readonly skippedNodes: readonly string[];
  readonly inactiveEdges: readonly string[];
  readonly events: readonly DGEvent[];
  readonly status: DGStatus | 'in-progress';
}

/**
 * Replay events up to a given index or predicate to rebuild state
 * without re-executing nodes.
 *
 * @param events - Full event log from a DGResult
 * @param until - Index (exclusive) or predicate. If predicate returns true, stop.
 */
export function replayUntil(
  events: readonly DGEvent[],
  until: number | ((event: DGEvent, index: number) => boolean),
): ReplaySnapshot {
  const completed = new Set<string>();
  const failed = new Set<string>();
  const skipped = new Set<string>();
  const inactive = new Set<string>();
  const replayed: DGEvent[] = [];
  let status: DGStatus | 'in-progress' = 'in-progress';

  const limit = typeof until === 'number' ? until : events.length;

  for (let i = 0; i < limit && i < events.length; i++) {
    const event = events[i]!;

    if (typeof until === 'function' && until(event, i)) {
      break;
    }

    replayed.push(event);

    switch (event.type) {
      case 'node.completed':
        completed.add(event.nodeId);
        break;
      case 'node.failed':
        failed.add(event.nodeId);
        break;
      case 'node.skipped':
        skipped.add(event.nodeId);
        break;
      case 'node.fallback':
        completed.add(event.nodeId);
        break;
      case 'edge.inactive':
        inactive.add(event.edgeId);
        break;
      case 'graph.completed':
        status = event.status;
        break;
    }
  }

  return {
    completedNodes: [...completed],
    failedNodes: [...failed],
    skippedNodes: [...skipped],
    inactiveEdges: [...inactive],
    events: replayed,
    status,
  };
}
