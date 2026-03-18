import type { DGGraph } from '../../types/graph.js';
import { DGCycleError } from '../../errors.js';

export function detectCycles(graph: DGGraph): void {
  const nodeIds = Object.keys(graph.nodes);
  if (nodeIds.length === 0) return;

  // Build adjacency + in-degree
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }

  for (const edge of graph.edges) {
    const list = adjacency.get(edge.from.node);
    if (list) list.push(edge.to.node);
    inDegree.set(edge.to.node, (inDegree.get(edge.to.node) ?? 0) + 1);
  }

  // Kahn's BFS
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  let visited = 0;
  while (queue.length > 0) {
    const node = queue.shift()!;
    visited++;
    for (const neighbor of adjacency.get(node) ?? []) {
      const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDeg);
      if (newDeg === 0) queue.push(neighbor);
    }
  }

  if (visited < nodeIds.length) {
    // Find one cycle for the error message via DFS
    const cyclePath = findCyclePath(adjacency, inDegree);
    throw new DGCycleError(`Cycle detected: ${cyclePath.join(' → ')}`, cyclePath);
  }
}

function findCyclePath(adjacency: Map<string, string[]>, inDegree: Map<string, number>): string[] {
  // Start from any node still in the cycle (inDegree > 0)
  const remaining = new Set<string>();
  for (const [id, deg] of inDegree) {
    if (deg > 0) remaining.add(id);
  }

  if (remaining.size === 0) return [];

  const start = remaining.values().next().value as string;
  const visited = new Set<string>();
  const path: string[] = [];

  let current: string | undefined = start;
  while (current && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    current = (adjacency.get(current) ?? []).find((n) => remaining.has(n));
  }

  if (current) {
    const cycleStart = path.indexOf(current);
    const cycle = path.slice(cycleStart);
    cycle.push(current);
    return cycle;
  }

  return [start];
}
