import type { DGGraph } from '../../types/graph.js';
import type { DGResult } from '../../types/result.js';

/**
 * Generate a Mermaid flowchart from a DGGraph, optionally annotated
 * with execution results.
 */
export function toMermaid(graph: DGGraph, result?: DGResult): string {
  const lines: string[] = ['graph TD'];

  // Nodes
  for (const [id, node] of Object.entries(graph.nodes)) {
    const label = node.model ? `${id}\\n(${node.type}:${node.model})` : `${id}\\n(${node.type})`;

    let shape: string;
    switch (node.type) {
      case 'branch':
        shape = `${id}{{"${label}"}}`;
        break;
      case 'guard':
        shape = `${id}{{"${label}"}}`;
        break;
      case 'merge':
        shape = `${id}([${label}])`;
        break;
      case 'enrich':
        shape = `${id}[/"${label}"/]`;
        break;
      default:
        shape = `${id}["${label}"]`;
    }

    lines.push(`  ${shape}`);

    // Style based on result
    if (result) {
      if (result.failed.includes(id)) {
        lines.push(`  style ${id} fill:#f66,stroke:#900`);
      } else if (result.skipped.includes(id)) {
        lines.push(`  style ${id} fill:#ddd,stroke:#999`);
      } else if (result.executed.includes(id)) {
        lines.push(`  style ${id} fill:#6f6,stroke:#090`);
      }
    }
  }

  // Edges
  for (const edge of graph.edges) {
    const from = edge.from.node;
    const to = edge.to.node;
    const label = edge.condition ? `|${edge.condition.dsl}|` : '';
    lines.push(`  ${from} -->${label} ${to}`);
  }

  return lines.join('\n');
}
