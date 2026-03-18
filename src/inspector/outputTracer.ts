import type { DGEvent } from '../types/events.js';

/**
 * Trace an output key backwards through the event log to find which nodes
 * contributed to producing it.
 *
 * @param key - Dot-separated key like "nodeId.portName"
 * @param events - The event log from a DGResult
 * @returns Array of node IDs that contributed to the key, in execution order
 */
export function traceOutput(key: string, events: readonly DGEvent[]): string[] {
  const [targetNode] = key.split('.');
  if (!targetNode) return [];

  const contributors: string[] = [];
  const visited = new Set<string>();
  const queue = [targetNode];

  // BFS backwards through completed nodes to find contributors
  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    if (visited.has(nodeId)) continue;
    visited.add(nodeId);

    // Find the node.started event to see what inputs it consumed
    const started = events.find(
      (e): e is Extract<DGEvent, { type: 'node.started' }> =>
        e.type === 'node.started' && e.nodeId === nodeId,
    );

    const completed = events.find(
      (e): e is Extract<DGEvent, { type: 'node.completed' }> =>
        e.type === 'node.completed' && e.nodeId === nodeId,
    );

    if (completed) {
      contributors.push(nodeId);
    }

    // If the node had inputs, find which nodes produced them
    if (started?.inputs) {
      // Look through all completed events to find which node produced values
      // that this node consumed
      for (const completedEvent of events) {
        if (completedEvent.type !== 'node.completed') continue;
        if (visited.has(completedEvent.nodeId)) continue;
        queue.push(completedEvent.nodeId);
      }
    }
  }

  // Return in execution order (order of appearance in events)
  const executionOrder = events
    .filter((e): e is Extract<DGEvent, { type: 'node.completed' }> => e.type === 'node.completed')
    .map((e) => e.nodeId);

  return contributors.sort((a, b) => executionOrder.indexOf(a) - executionOrder.indexOf(b));
}
