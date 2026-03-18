import type { DGGraph } from '../../types/graph.js';
import type { PortWiring, WiringMap } from '../../types/ports.js';

export function resolveWiring(graph: DGGraph): WiringMap {
  const wiring: Map<string, PortWiring[]> = new Map();

  // Initialize empty arrays for all nodes
  for (const nodeId of Object.keys(graph.nodes)) {
    wiring.set(nodeId, []);
  }

  // Build wiring from edges
  for (const edge of graph.edges) {
    const entry: PortWiring = {
      fromNode: edge.from.node,
      fromPort: edge.from.port,
      toNode: edge.to.node,
      toPort: edge.to.port,
      ...(edge.portAlias !== undefined ? { aliasedAs: edge.portAlias } : {}),
    };
    wiring.get(edge.to.node)?.push(entry);
  }

  // Root nodes (no incoming edges) get input.* wiring from their port declarations
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const wirings = wiring.get(nodeId);
    if (!wirings || wirings.length > 0) continue;

    // This is a root node — wire input ports from input namespace
    for (const port of node.ports.in) {
      wirings.push({
        fromNode: 'input',
        fromPort: port.name,
        toNode: nodeId,
        toPort: port.name,
      });
    }
  }

  return wiring;
}
