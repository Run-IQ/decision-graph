import type { DGGraph } from '../../types/graph.js';
import type { DGResult } from '../../types/result.js';

export interface DGVisualizationNode {
  readonly id: string;
  readonly type: string;
  readonly model?: string;
  readonly status?: 'completed' | 'failed' | 'skipped' | 'not-executed';
  readonly durationMs?: number;
}

export interface DGVisualizationEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly condition?: string;
  readonly inactive?: boolean;
}

export interface DGVisualizationData {
  readonly graphId: string;
  readonly nodes: readonly DGVisualizationNode[];
  readonly edges: readonly DGVisualizationEdge[];
  readonly status?: string;
  readonly durationMs?: number;
}

/**
 * Convert a DGGraph (with optional result) into a structured visualization
 * data object suitable for rendering in UI frameworks.
 */
export function toVisualizationData(graph: DGGraph, result?: DGResult): DGVisualizationData {
  const nodes: DGVisualizationNode[] = Object.entries(graph.nodes).map(([id, node]) => {
    let status: DGVisualizationNode['status'];
    let durationMs: number | undefined;

    if (result) {
      if (result.executed.includes(id)) {
        status = 'completed';
        const ev = result.events.find((e) => e.type === 'node.completed' && e.nodeId === id);
        if (ev && ev.type === 'node.completed') {
          durationMs = ev.durationMs;
        }
      } else if (result.failed.includes(id)) {
        status = 'failed';
      } else if (result.skipped.includes(id)) {
        status = 'skipped';
      } else {
        status = 'not-executed';
      }
    }

    return {
      id,
      type: node.type,
      ...(node.model !== undefined ? { model: node.model } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(durationMs !== undefined ? { durationMs } : {}),
    };
  });

  const edges: DGVisualizationEdge[] = graph.edges.map((edge) => {
    const inactive = result
      ? result.events.some((e) => e.type === 'edge.inactive' && e.edgeId === edge.id)
      : undefined;

    return {
      id: edge.id,
      from: edge.from.node,
      to: edge.to.node,
      ...(edge.condition ? { condition: edge.condition.dsl } : {}),
      ...(inactive !== undefined ? { inactive } : {}),
    };
  });

  return {
    graphId: graph.id,
    nodes,
    edges,
    ...(result ? { status: result.status, durationMs: result.durationMs } : {}),
  };
}
