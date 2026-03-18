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

  // Kahn's BFS — detect if any cycles exist
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
    // Find ALL cycles by extracting cycles from remaining nodes
    const cycles = findAllCycles(adjacency, inDegree);
    const descriptions = cycles.map((c) => c.join(' → ')).join('; ');
    throw new DGCycleError(`${cycles.length} cycle(s) detected: ${descriptions}`, cycles);
  }
}

/**
 * Find all distinct cycles among nodes that remain after Kahn's algorithm
 * (i.e., nodes with inDegree > 0). Uses iterative cycle extraction:
 * for each unvisited remaining node, trace a path until we hit a visited node,
 * then extract the cycle.
 */
function findAllCycles(
  adjacency: Map<string, string[]>,
  inDegree: Map<string, number>,
): string[][] {
  const remaining = new Set<string>();
  for (const [id, deg] of inDegree) {
    if (deg > 0) remaining.add(id);
  }

  if (remaining.size === 0) return [];

  // Build a sub-adjacency restricted to remaining nodes
  const subAdj = new Map<string, string[]>();
  for (const id of remaining) {
    subAdj.set(
      id,
      (adjacency.get(id) ?? []).filter((n) => remaining.has(n)),
    );
  }

  const cycles: string[][] = [];
  const globalVisited = new Set<string>();

  for (const startNode of remaining) {
    if (globalVisited.has(startNode)) continue;

    const cycle = traceCycle(startNode, subAdj, remaining);
    if (cycle.length > 0) {
      cycles.push(cycle);
      for (const nodeId of cycle.slice(0, -1)) {
        globalVisited.add(nodeId);
      }
    }
  }

  return cycles;
}

function traceCycle(start: string, adj: Map<string, string[]>, remaining: Set<string>): string[] {
  const visited = new Set<string>();
  const path: string[] = [];

  let current: string | undefined = start;
  while (current && !visited.has(current)) {
    visited.add(current);
    path.push(current);
    current = (adj.get(current) ?? []).find((n) => remaining.has(n));
  }

  if (current) {
    const cycleStart = path.indexOf(current);
    const cycle = path.slice(cycleStart);
    cycle.push(current); // close the cycle
    return cycle;
  }

  return [];
}
