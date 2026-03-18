import type { DGGraph, DGNode, DGEdge, EdgeCondition } from '../../src/types/graph.js';

export function computeNode(
  id: string,
  opts?: {
    model?: string;
    inPorts?: { name: string; required?: boolean; default?: unknown }[];
    outPorts?: { name: string; required?: boolean }[];
    onError?: 'fail' | 'skip' | 'fallback';
    onFailPropagation?: 'halt' | 'skip-descendants' | 'continue';
    fallback?: Record<string, unknown>;
    storeRaw?: boolean;
    timeout?: number;
  },
): DGNode {
  return {
    id,
    type: 'compute',
    model: opts?.model ?? 'M',
    ports: {
      in: (opts?.inPorts ?? [{ name: 'v', required: false }]).map((p) => ({
        name: p.name,
        required: p.required ?? false,
        ...(p.default !== undefined ? { default: p.default } : {}),
      })),
      out: (opts?.outPorts ?? [{ name: 'v', required: false }]).map((p) => ({
        name: p.name,
        required: p.required ?? false,
      })),
    },
    policy: {
      onError: opts?.onError ?? 'fail',
      onFailPropagation: opts?.onFailPropagation ?? 'halt',
      ...(opts?.fallback !== undefined ? { fallback: opts.fallback } : {}),
      ...(opts?.storeRaw !== undefined ? { storeRaw: opts.storeRaw } : {}),
      ...(opts?.timeout !== undefined ? { timeout: opts.timeout } : {}),
    },
  };
}

export function mergeNode(
  id: string,
  opts?: {
    strategy?: 'wait-all' | 'wait-any' | 'wait-quorum';
    quorum?: number;
    onPartialInputs?: 'fail' | 'proceed-with-available' | 'use-defaults';
    model?: string;
  },
): DGNode {
  return {
    id,
    type: 'merge',
    ...(opts?.model !== undefined ? { model: opts.model } : {}),
    ports: {
      in: [{ name: 'v', required: false, default: 0 }],
      out: [{ name: 'v', required: false }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    meta: {
      mergeConfig: {
        strategy: opts?.strategy ?? 'wait-all',
        ...(opts?.quorum !== undefined ? { quorum: opts.quorum } : {}),
        onPartialInputs: opts?.onPartialInputs ?? 'fail',
      },
    },
  };
}

export function branchNode(id: string): DGNode {
  return {
    id,
    type: 'branch',
    model: 'M',
    ports: {
      in: [{ name: 'v', required: false }],
      out: [{ name: 'v', required: false }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

export function edge(id: string, from: string, to: string, condition?: EdgeCondition): DGEdge {
  return {
    id,
    from: { node: from, port: 'v' },
    to: { node: to, port: 'v' },
    ...(condition !== undefined ? { condition } : {}),
  };
}

export function linearGraph(nodeIds: string[]): DGGraph {
  const nodes: Record<string, DGNode> = {};
  const edges: DGEdge[] = [];
  for (const id of nodeIds) {
    nodes[id] = computeNode(id);
  }
  for (let i = 0; i < nodeIds.length - 1; i++) {
    edges.push(edge(`e${i}`, nodeIds[i]!, nodeIds[i + 1]!));
  }
  return { id: 'test-graph', version: '1', nodes, edges };
}

export function diamondGraph(): DGGraph {
  return {
    id: 'diamond',
    version: '1',
    nodes: {
      root: computeNode('root'),
      left: computeNode('left'),
      right: computeNode('right'),
      merge: mergeNode('merge'),
    },
    edges: [
      edge('e1', 'root', 'left'),
      edge('e2', 'root', 'right'),
      edge('e3', 'left', 'merge'),
      edge('e4', 'right', 'merge'),
    ],
  };
}
