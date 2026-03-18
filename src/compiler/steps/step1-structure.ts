import type { DGGraph, DGNode } from '../../types/graph.js';
import type { MergeNodeConfig } from '../../types/policy.js';
import { DGCompileError } from '../../errors.js';

const STEP = 1;

function fail(msg: string): never {
  throw new DGCompileError(msg, STEP);
}

function getIncomingCount(graph: DGGraph, nodeId: string): number {
  let count = 0;
  for (const edge of graph.edges) {
    if (edge.to.node === nodeId) count++;
  }
  return count;
}

function validateEdges(graph: DGGraph): void {
  for (const edge of graph.edges) {
    const fromNode = graph.nodes[edge.from.node];
    if (!fromNode) {
      fail(`Edge "${edge.id}": from.node "${edge.from.node}" does not exist`);
    }
    const toNode = graph.nodes[edge.to.node];
    if (!toNode) {
      fail(`Edge "${edge.id}": to.node "${edge.to.node}" does not exist`);
    }

    const fromPort = fromNode.ports.out.find((p) => p.name === edge.from.port);
    if (!fromPort) {
      fail(
        `Edge "${edge.id}": from.port "${edge.from.port}" not found in node "${edge.from.node}" output ports`,
      );
    }

    const toPort = toNode.ports.in.find((p) => p.name === edge.to.port);
    if (!toPort) {
      fail(
        `Edge "${edge.id}": to.port "${edge.to.port}" not found in node "${edge.to.node}" input ports`,
      );
    }
  }
}

function validateNodes(graph: DGGraph): void {
  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    validateComputeModel(nodeId, node);
    validateFallback(nodeId, node);
    validateMergeQuorum(graph, nodeId, node);
  }
}

function validateComputeModel(nodeId: string, node: DGNode): void {
  if (node.type === 'compute' && !node.model) {
    fail(`Node "${nodeId}" is type "compute" but has no model defined`);
  }
}

function validateFallback(nodeId: string, node: DGNode): void {
  if (node.policy.onError === 'fallback') {
    if (!node.policy.fallback) {
      fail(`Node "${nodeId}" has onError "fallback" but no fallback values defined`);
    }
    const outPortNames = new Set(node.ports.out.map((p) => p.name));
    for (const key of Object.keys(node.policy.fallback)) {
      if (!outPortNames.has(key)) {
        fail(`Node "${nodeId}" fallback key "${key}" does not match any output port`);
      }
    }
  }
}

function validateMergeQuorum(graph: DGGraph, nodeId: string, node: DGNode): void {
  if (node.type !== 'merge') return;

  const mergeConfig = node.meta?.['mergeConfig'] as MergeNodeConfig | undefined;
  if (!mergeConfig) return;

  if (mergeConfig.strategy === 'wait-quorum') {
    if (mergeConfig.quorum === undefined || mergeConfig.quorum === null) {
      fail(`Merge node "${nodeId}" uses wait-quorum but quorum is not defined`);
    }
    const parentCount = getIncomingCount(graph, nodeId);
    if (mergeConfig.quorum < 1 || mergeConfig.quorum > parentCount) {
      fail(
        `Merge node "${nodeId}" quorum ${mergeConfig.quorum} is out of range [1, ${parentCount}]`,
      );
    }
  }
}

export function validateStructure(graph: DGGraph): void {
  validateEdges(graph);
  validateNodes(graph);
}
