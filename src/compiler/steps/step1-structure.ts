import type { DGGraph, DGNode } from '../../types/graph.js';
import type { MergeNodeConfig } from '../../types/policy.js';
import type { EnrichConfig } from '../../types/enrich.js';
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
    validateEnrichConfig(nodeId, node);
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

function validateEnrichConfig(nodeId: string, node: DGNode): void {
  if (node.type !== 'enrich') return;

  if (node.model) {
    fail(
      `Enrich node "${nodeId}" must not have a model — enrich nodes fetch data, not evaluate rules`,
    );
  }

  const cfg = node.meta?.['enrichConfig'] as EnrichConfig | undefined;
  if (!cfg) {
    fail(`Enrich node "${nodeId}" is missing meta.enrichConfig`);
  }

  if (typeof cfg.endpoint !== 'string' || cfg.endpoint.trim() === '') {
    fail(`Enrich node "${nodeId}": enrichConfig.endpoint must be a non-empty string`);
  }
  if (cfg.method !== undefined && cfg.method !== 'GET' && cfg.method !== 'POST') {
    fail(`Enrich node "${nodeId}": enrichConfig.method must be "GET" or "POST"`);
  }
  if (typeof cfg.timeoutMs !== 'number' || cfg.timeoutMs <= 0 || cfg.timeoutMs > 5000) {
    fail(`Enrich node "${nodeId}": enrichConfig.timeoutMs must be > 0 and <= 5000`);
  }
  if (cfg.retry !== undefined && (cfg.retry < 0 || cfg.retry > 3)) {
    fail(`Enrich node "${nodeId}": enrichConfig.retry must be 0–3`);
  }
  if (cfg.onFailure !== 'fail' && cfg.onFailure !== 'fallback') {
    fail(`Enrich node "${nodeId}": enrichConfig.onFailure must be "fail" or "fallback"`);
  }
  if (!cfg.outputMapping || Object.keys(cfg.outputMapping).length === 0) {
    fail(`Enrich node "${nodeId}": enrichConfig.outputMapping is required and must be non-empty`);
  }

  // If onFailure is 'fallback', the node policy must also have fallback defined
  if (cfg.onFailure === 'fallback') {
    if (node.policy.onError !== 'fallback' || !node.policy.fallback) {
      fail(
        `Enrich node "${nodeId}": enrichConfig.onFailure is "fallback" but ` +
          `node.policy.onError is not "fallback" or policy.fallback is missing`,
      );
    }
  }
}

export function validateStructure(graph: DGGraph): void {
  validateEdges(graph);
  validateNodes(graph);
}
