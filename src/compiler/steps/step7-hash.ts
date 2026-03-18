import type { DGGraph } from '../../types/graph.js';
import { sha256 } from '@run-iq/context-engine';

export function computeGraphHash(graph: DGGraph): string {
  const hashPayload = JSON.stringify({
    id: graph.id,
    version: graph.version,
    nodes: graph.nodes,
    edges: graph.edges,
  });
  return sha256(hashPayload);
}
