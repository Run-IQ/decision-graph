import type { DGGraph } from '../../types/graph.js';
import type { MergeNodeConfig } from '../../types/policy.js';
import type { CompileWarning } from '../../types/compiled.js';
import { DGCompileError } from '../../errors.js';

const STEP = 6;

export function validatePolicies(graph: DGGraph, strict: boolean): CompileWarning[] {
  const warnings: CompileWarning[] = [];

  checkDeadlocks(graph);
  checkStoreRawCount(graph, warnings);
  checkMergeQuorumFullContext(graph, warnings);

  if (strict && warnings.length > 0) {
    const msgs = warnings.map((w) => w.message).join('; ');
    throw new DGCompileError(`Strict mode — warnings treated as errors: ${msgs}`, STEP);
  }

  return warnings;
}

function getParentNodes(graph: DGGraph, nodeId: string): string[] {
  const parents: string[] = [];
  for (const edge of graph.edges) {
    if (edge.to.node === nodeId) {
      parents.push(edge.from.node);
    }
  }
  return parents;
}

function checkDeadlocks(graph: DGGraph): void {
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'merge') continue;

    const mergeConfig = node.meta?.['mergeConfig'] as MergeNodeConfig | undefined;
    if (!mergeConfig || mergeConfig.strategy !== 'wait-all') continue;

    const parents = getParentNodes(graph, nodeId);
    for (const parentId of parents) {
      const parentNode = graph.nodes[parentId];
      if (!parentNode) continue;

      if (parentNode.policy.onError === 'skip') {
        throw new DGCompileError(
          `Deadlock detected. Node "${nodeId}" (merge, wait-all) has parent "${parentId}" ` +
            `with policy { onError: 'skip' }. ` +
            `A skipped parent never produces output → deadlock guaranteed. ` +
            `Fix: use merge strategy 'wait-any', or change onError to 'fallback'.`,
          STEP,
        );
      }
    }
  }
}

function checkStoreRawCount(graph: DGGraph, warnings: CompileWarning[]): void {
  const storeRawNodes: string[] = [];
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.policy.storeRaw === true) {
      storeRawNodes.push(nodeId);
    }
  }
  if (storeRawNodes.length > 3) {
    warnings.push({
      step: STEP,
      message: `${storeRawNodes.length} nodes have storeRaw: true (${storeRawNodes.join(', ')}). This may overload the context.`,
    });
  }
}

function checkMergeQuorumFullContext(graph: DGGraph, warnings: CompileWarning[]): void {
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    if (node.type !== 'merge') continue;

    const mergeConfig = node.meta?.['mergeConfig'] as MergeNodeConfig | undefined;
    if (!mergeConfig || mergeConfig.strategy !== 'wait-quorum') continue;

    // Check if any incoming edge uses full-context scope
    for (const edge of graph.edges) {
      if (edge.to.node === nodeId && edge.condition?.scope === 'full-context') {
        warnings.push({
          step: STEP,
          message: `Merge node "${nodeId}" uses wait-quorum with edge "${edge.id}" using full-context scope. Effective quorum is unpredictable statically.`,
          nodeId,
          edgeId: edge.id,
        });
      }
    }
  }
}
