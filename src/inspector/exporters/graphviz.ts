import type { DGGraph } from '../../types/graph.js';
import type { DGResult } from '../../types/result.js';

/**
 * Generate a Graphviz DOT representation of a DGGraph,
 * optionally annotated with execution results.
 */
export function toGraphviz(graph: DGGraph, result?: DGResult): string {
  const lines: string[] = [
    `digraph "${graph.id}" {`,
    '  rankdir=TB;',
    '  node [fontname="Helvetica"];',
  ];

  // Nodes
  for (const [id, node] of Object.entries(graph.nodes)) {
    const label = node.model ? `${id}\\n(${node.type}:${node.model})` : `${id}\\n(${node.type})`;

    const attrs: string[] = [`label="${label}"`];

    switch (node.type) {
      case 'branch':
      case 'guard':
        attrs.push('shape=diamond');
        break;
      case 'merge':
        attrs.push('shape=ellipse');
        break;
      case 'enrich':
        attrs.push('shape=parallelogram');
        break;
      default:
        attrs.push('shape=box');
    }

    if (result) {
      if (result.failed.includes(id)) {
        attrs.push('style=filled', 'fillcolor="#ff6666"');
      } else if (result.skipped.includes(id)) {
        attrs.push('style=filled', 'fillcolor="#dddddd"');
      } else if (result.executed.includes(id)) {
        attrs.push('style=filled', 'fillcolor="#66ff66"');
      }
    }

    lines.push(`  ${id} [${attrs.join(', ')}];`);
  }

  // Edges
  for (const edge of graph.edges) {
    const attrs: string[] = [];
    if (edge.condition) {
      attrs.push(`label="${edge.condition.dsl}"`);
    }
    const attrStr = attrs.length > 0 ? ` [${attrs.join(', ')}]` : '';
    lines.push(`  ${edge.from.node} -> ${edge.to.node}${attrStr};`);
  }

  lines.push('}');
  return lines.join('\n');
}
