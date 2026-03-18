import type { DGResult } from '../types/result.js';
import type { DGGraph } from '../types/graph.js';

export interface CriticalPathResult {
  readonly path: readonly string[];
  readonly totalDurationMs: number;
}

/**
 * Compute the critical path of a graph execution — the longest chain
 * of sequential node executions that determined the total execution time.
 *
 * Uses node durations from events + graph edges to find the longest path.
 */
export function criticalPath(result: DGResult, graph: DGGraph): CriticalPathResult {
  // Build duration map from events
  const durations = new Map<string, number>();
  for (const event of result.events) {
    if (event.type === 'node.completed') {
      durations.set(event.nodeId, event.durationMs);
    }
  }

  // Build adjacency list (forward edges)
  const children = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const existing = children.get(edge.from.node) ?? [];
    existing.push(edge.to.node);
    children.set(edge.from.node, existing);
  }

  // Find root nodes (no incoming edges) that were executed
  const hasIncoming = new Set(graph.edges.map((e) => e.to.node));
  const roots = result.executed.filter((n) => !hasIncoming.has(n));

  // DFS to find longest path
  const memo = new Map<string, { cost: number; path: string[] }>();

  function longestFrom(nodeId: string): { cost: number; path: string[] } {
    const cached = memo.get(nodeId);
    if (cached) return cached;

    const nodeDuration = durations.get(nodeId) ?? 0;
    const kids = (children.get(nodeId) ?? []).filter((c) => durations.has(c));

    if (kids.length === 0) {
      const result = { cost: nodeDuration, path: [nodeId] };
      memo.set(nodeId, result);
      return result;
    }

    let best = { cost: 0, path: [] as string[] };
    for (const child of kids) {
      const sub = longestFrom(child);
      if (sub.cost > best.cost) {
        best = sub;
      }
    }

    const result = { cost: nodeDuration + best.cost, path: [nodeId, ...best.path] };
    memo.set(nodeId, result);
    return result;
  }

  let overall = { cost: 0, path: [] as string[] };
  for (const root of roots) {
    const r = longestFrom(root);
    if (r.cost > overall.cost) {
      overall = r;
    }
  }

  return {
    path: overall.path,
    totalDurationMs: overall.cost,
  };
}
