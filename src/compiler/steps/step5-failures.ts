import type { DGGraph } from '../../types/graph.js';
import type { FailurePropagationMap } from '../../types/compiled.js';

export function buildFailurePropagationMap(graph: DGGraph): FailurePropagationMap {
  const map: FailurePropagationMap = new Map();

  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const id of Object.keys(graph.nodes)) {
    adjacency.set(id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from.node)?.push(edge.to.node);
  }

  // For each node, DFS to find all transitive descendants
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const descendants = findDescendants(nodeId, adjacency);
    map.set(nodeId, {
      policy: node.policy.onFailPropagation,
      descendants,
    });
  }

  return map;
}

function findDescendants(startId: string, adjacency: Map<string, string[]>): string[] {
  const visited = new Set<string>();
  const stack = [...(adjacency.get(startId) ?? [])];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const neighbor of adjacency.get(current) ?? []) {
      if (!visited.has(neighbor)) stack.push(neighbor);
    }
  }

  return [...visited];
}
