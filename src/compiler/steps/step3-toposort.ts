import type { DGGraph } from '../../types/graph.js';
import type { ExecutionLevel } from '../../types/compiled.js';
import type { ExecutionLimits } from '../../types/policy.js';
import { DEFAULT_LIMITS } from '../../types/policy.js';
import { DGLimitError } from '../../errors.js';

export function topologicalSort(graph: DGGraph, limits?: ExecutionLimits): ExecutionLevel[] {
  const maxNodes = limits?.maxNodes ?? DEFAULT_LIMITS.maxNodes;
  const maxDepth = limits?.maxDepth ?? DEFAULT_LIMITS.maxDepth;
  const nodeIds = Object.keys(graph.nodes);

  if (nodeIds.length > maxNodes) {
    throw new DGLimitError(`Graph has ${nodeIds.length} nodes, exceeds maxNodes (${maxNodes})`);
  }

  if (nodeIds.length === 0) return [];

  // Build in-degree and adjacency
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();
  for (const id of nodeIds) {
    inDegree.set(id, 0);
    adjacency.set(id, []);
  }
  for (const edge of graph.edges) {
    adjacency.get(edge.from.node)?.push(edge.to.node);
    inDegree.set(edge.to.node, (inDegree.get(edge.to.node) ?? 0) + 1);
  }

  // BFS level-by-level
  let currentLevel: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) currentLevel.push(id);
  }

  const levels: ExecutionLevel[] = [];
  let levelIndex = 0;

  while (currentLevel.length > 0) {
    if (levelIndex >= maxDepth) {
      throw new DGLimitError(`Graph depth ${levelIndex + 1} exceeds maxDepth (${maxDepth})`);
    }

    // Separate merge nodes from regular nodes
    const regularNodes: string[] = [];
    const mergeNodes: string[] = [];
    for (const id of currentLevel) {
      const node = graph.nodes[id];
      if (node?.type === 'merge') {
        mergeNodes.push(id);
      } else {
        regularNodes.push(id);
      }
    }

    levels.push({
      index: levelIndex,
      nodes: regularNodes,
      mergeNodes,
    });

    // Find next level
    const nextLevel: string[] = [];
    for (const id of currentLevel) {
      for (const neighbor of adjacency.get(id) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) nextLevel.push(neighbor);
      }
    }

    currentLevel = nextLevel;
    levelIndex++;
  }

  return levels;
}
