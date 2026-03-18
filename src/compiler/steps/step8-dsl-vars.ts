import type { DGGraph } from '../../types/graph.js';
import type {
  ExecutionLevel,
  DSLVariableMap,
  DSLVariableAnalysis,
  ResolvedVar,
  CompileWarning,
} from '../../types/compiled.js';
import { DGCompileError } from '../../errors.js';

const STEP = 8;

/**
 * Walk a JSONLogic expression and extract all { "var": "..." } references.
 */
function extractVarRefs(expression: unknown): string[] {
  const vars: string[] = [];

  function walk(node: unknown): void {
    if (node === null || node === undefined) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === 'object') {
      const obj = node as Record<string, unknown>;
      if ('var' in obj && typeof obj['var'] === 'string') {
        vars.push(obj['var']);
      }
      for (const value of Object.values(obj)) {
        walk(value);
      }
    }
  }

  walk(expression);
  return vars;
}

/**
 * Build a map: nodeId.portName → level index, plus input.* → -1, meta.* → -1
 */
function buildProducerLevelMap(
  graph: DGGraph,
  levels: readonly ExecutionLevel[],
): Map<string, { producer: string | 'input' | 'meta'; level: number }> {
  const map = new Map<string, { producer: string | 'input' | 'meta'; level: number }>();

  // All node outputs
  for (const level of levels) {
    const allNodes = [...level.nodes, ...level.mergeNodes];
    for (const nodeId of allNodes) {
      const node = graph.nodes[nodeId];
      if (!node) continue;
      for (const port of node.ports.out) {
        map.set(`${nodeId}.${port.name}`, { producer: nodeId, level: level.index });
      }
    }
  }

  // input.* namespace — level -1 (always available)
  for (const node of Object.values(graph.nodes)) {
    for (const port of node.ports.in) {
      const key = `input.${port.name}`;
      if (!map.has(key)) {
        map.set(key, { producer: 'input', level: -1 });
      }
    }
  }

  return map;
}

function getNodeLevel(nodeId: string, levels: readonly ExecutionLevel[]): number {
  for (const level of levels) {
    if (level.nodes.includes(nodeId) || level.mergeNodes.includes(nodeId)) {
      return level.index;
    }
  }
  return -1;
}

export function analyzeDSLVariables(
  graph: DGGraph,
  levels: readonly ExecutionLevel[],
): { dslVars: DSLVariableMap; warnings: CompileWarning[] } {
  const dslVars: DSLVariableMap = new Map();
  const warnings: CompileWarning[] = [];
  const producerMap = buildProducerLevelMap(graph, levels);

  for (const edge of graph.edges) {
    if (!edge.condition) continue;

    const referencedVars = extractVarRefs(edge.condition.expression);
    if (referencedVars.length === 0) {
      dslVars.set(edge.id, {
        edgeId: edge.id,
        referencedVars: [],
        resolvedVars: [],
        undeclaredVars: [],
      });
      continue;
    }

    const destLevel = getNodeLevel(edge.to.node, levels);
    const resolvedVars: ResolvedVar[] = [];
    const undeclaredVars: string[] = [];

    for (const varPath of referencedVars) {
      const producerInfo = producerMap.get(varPath);

      if (!producerInfo) {
        // Try matching as a direct node output: "portName" in source-output scope
        if (edge.condition.scope === 'source-output') {
          const sourceNode = graph.nodes[edge.from.node];
          const fromPort = sourceNode?.ports.out.find((p) => p.name === varPath);
          if (fromPort) {
            const sourceLevel = getNodeLevel(edge.from.node, levels);
            resolvedVars.push({
              varPath,
              producerNode: edge.from.node,
              producerLevel: sourceLevel,
              destinationLevel: destLevel,
              valid: sourceLevel < destLevel,
            });
            continue;
          }
        }
        undeclaredVars.push(varPath);
        continue;
      }

      const valid = producerInfo.level < destLevel;
      if (!valid) {
        throw new DGCompileError(
          `Edge "${edge.id}": variable "${varPath}" is produced at level ${producerInfo.level} ` +
            `but consumed at level ${destLevel} — race condition. ` +
            `Producer must be at a strictly lower level.`,
          STEP,
        );
      }

      resolvedVars.push({
        varPath,
        producerNode: producerInfo.producer,
        producerLevel: producerInfo.level,
        destinationLevel: destLevel,
        valid,
      });
    }

    if (undeclaredVars.length > 0) {
      warnings.push({
        step: STEP,
        message: `Edge "${edge.id}": variables [${undeclaredVars.join(', ')}] not found in any node output. They may come from meta.context.`,
        edgeId: edge.id,
      });
    }

    const analysis: DSLVariableAnalysis = {
      edgeId: edge.id,
      referencedVars,
      resolvedVars,
      undeclaredVars,
    };
    dslVars.set(edge.id, analysis);
  }

  return { dslVars, warnings };
}
