import type { DGGraph } from '../../types/graph.js';
import { IDENTIFIER_PATTERN } from '../../types/graph.js';
import { DGCompileError } from '../../errors.js';

const STEP = 0;

function assertId(value: string, label: string): void {
  if (!IDENTIFIER_PATTERN.test(value)) {
    throw new DGCompileError(
      `Invalid identifier ${label}: "${value}" — must match ${IDENTIFIER_PATTERN.source}`,
      STEP,
    );
  }
}

export function validateIdentifiers(graph: DGGraph): void {
  assertId(graph.id, 'graph.id');

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    assertId(nodeId, `nodeId`);
    if (node.id !== nodeId) {
      throw new DGCompileError(`Node key "${nodeId}" does not match node.id "${node.id}"`, STEP);
    }
    for (const port of node.ports.in) {
      assertId(port.name, `node "${nodeId}" input port`);
    }
    for (const port of node.ports.out) {
      assertId(port.name, `node "${nodeId}" output port`);
    }
  }

  for (const edge of graph.edges) {
    assertId(edge.id, 'edge.id');
  }
}
