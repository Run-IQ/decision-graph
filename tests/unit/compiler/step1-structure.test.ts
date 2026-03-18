import { describe, it, expect } from 'vitest';
import { validateStructure } from '../../../src/compiler/steps/step1-structure.js';
import { DGCompileError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function makeNode(overrides: Partial<DGNode> = {}): DGNode {
  return {
    id: 'n',
    type: 'compute',
    model: 'M',
    ports: { in: [], out: [{ name: 'value', required: true }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    ...overrides,
  };
}

function twoNodeGraph(): DGGraph {
  return {
    id: 'g',
    version: '1.0.0',
    nodes: {
      a: {
        ...makeNode({ id: 'a' }),
        ports: { in: [], out: [{ name: 'value', required: true }] },
      },
      b: {
        ...makeNode({ id: 'b' }),
        ports: { in: [{ name: 'value', required: true }], out: [] },
      },
    },
    edges: [{ id: 'e1', from: { node: 'a', port: 'value' }, to: { node: 'b', port: 'value' } }],
  };
}

describe('step1-structure', () => {
  it('accepts a valid graph', () => {
    expect(() => validateStructure(twoNodeGraph())).not.toThrow();
  });

  it('accepts empty graph', () => {
    expect(() =>
      validateStructure({ id: 'g', version: '1.0.0', nodes: {}, edges: [] }),
    ).not.toThrow();
  });

  it('rejects edge referencing nonexistent from.node', () => {
    const g = twoNodeGraph();
    (g.edges as { from: { node: string; port: string } }[])[0]!.from.node = 'nope';
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects edge referencing nonexistent to.node', () => {
    const g = twoNodeGraph();
    (g.edges as { to: { node: string; port: string } }[])[0]!.to.node = 'nope';
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects edge referencing nonexistent from.port', () => {
    const g = twoNodeGraph();
    (g.edges as { from: { node: string; port: string } }[])[0]!.from.port = 'nope';
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects edge referencing nonexistent to.port', () => {
    const g = twoNodeGraph();
    (g.edges as { to: { node: string; port: string } }[])[0]!.to.port = 'nope';
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects compute node without model', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { n: makeNode({ id: 'n', model: undefined }) },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects fallback with missing fallback values', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        n: makeNode({
          id: 'n',
          policy: { onError: 'fallback', onFailPropagation: 'halt' },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects fallback key not matching output ports', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        n: makeNode({
          id: 'n',
          policy: {
            onError: 'fallback',
            onFailPropagation: 'halt',
            fallback: { bogus: 0 },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('accepts valid fallback matching output ports', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        n: makeNode({
          id: 'n',
          policy: {
            onError: 'fallback',
            onFailPropagation: 'halt',
            fallback: { value: 0 },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).not.toThrow();
  });

  it('rejects wait-quorum without quorum', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        a: makeNode({ id: 'a' }),
        m: {
          id: 'm',
          type: 'merge',
          ports: { in: [{ name: 'value', required: true }], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
          meta: { mergeConfig: { strategy: 'wait-quorum', onPartialInputs: 'fail' } },
        },
      },
      edges: [{ id: 'e1', from: { node: 'a', port: 'value' }, to: { node: 'm', port: 'value' } }],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  it('rejects quorum out of range', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        a: makeNode({ id: 'a' }),
        m: {
          id: 'm',
          type: 'merge',
          ports: { in: [{ name: 'value', required: true }], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
          meta: { mergeConfig: { strategy: 'wait-quorum', quorum: 5, onPartialInputs: 'fail' } },
        },
      },
      edges: [{ id: 'e1', from: { node: 'a', port: 'value' }, to: { node: 'm', port: 'value' } }],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
  });

  // --- Enrich node validation ---

  function enrichNode(overrides: Partial<DGNode> = {}): DGNode {
    return {
      id: 'e',
      type: 'enrich',
      ports: { in: [{ name: 'nif', required: true }], out: [{ name: 'regime', required: true }] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
      meta: {
        enrichConfig: {
          endpoint: 'https://api.example.com/data',
          timeoutMs: 3000,
          onFailure: 'fail',
          inputMapping: { nif: 'company.nif' },
          outputMapping: { regime: 'data.regime' },
        },
      },
      ...overrides,
    };
  }

  it('accepts a valid enrich node', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { e: enrichNode() },
      edges: [],
    };
    expect(() => validateStructure(g)).not.toThrow();
  });

  it('rejects enrich node with model', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { e: enrichNode({ model: 'FLAT_RATE' }) },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
    expect(() => validateStructure(g)).toThrow('must not have a model');
  });

  it('rejects enrich node missing enrichConfig', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { e: enrichNode({ meta: {} }) },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
    expect(() => validateStructure(g)).toThrow('missing meta.enrichConfig');
  });

  it('rejects enrich node with empty endpoint', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: '',
              timeoutMs: 3000,
              onFailure: 'fail',
              inputMapping: {},
              outputMapping: { r: 'r' },
            },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('endpoint must be a non-empty string');
  });

  it('rejects enrich node with timeoutMs > 5000', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: 'https://api.example.com',
              timeoutMs: 10000,
              onFailure: 'fail',
              inputMapping: {},
              outputMapping: { r: 'r' },
            },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('timeoutMs must be > 0 and <= 5000');
  });

  it('rejects enrich node with retry > 3', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: 'https://api.example.com',
              timeoutMs: 3000,
              onFailure: 'fail',
              retry: 5,
              inputMapping: {},
              outputMapping: { r: 'r' },
            },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('retry must be 0–3');
  });

  it('rejects enrich node with empty outputMapping', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: 'https://api.example.com',
              timeoutMs: 3000,
              onFailure: 'fail',
              inputMapping: {},
              outputMapping: {},
            },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('outputMapping is required');
  });

  it('rejects enrich onFailure=fallback without policy.fallback', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: 'https://api.example.com',
              timeoutMs: 3000,
              onFailure: 'fallback',
              inputMapping: {},
              outputMapping: { r: 'r' },
            },
          },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('policy.onError is not "fallback"');
  });

  it('accepts enrich onFailure=fallback with matching policy', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        e: enrichNode({
          meta: {
            enrichConfig: {
              endpoint: 'https://api.example.com',
              timeoutMs: 3000,
              onFailure: 'fallback',
              inputMapping: {},
              outputMapping: { regime: 'data.regime' },
            },
          },
          policy: {
            onError: 'fallback',
            onFailPropagation: 'continue',
            fallback: { regime: 'default' },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).not.toThrow();
  });

  // --- Subgraph node validation ---

  function sgNode(overrides: Partial<DGNode> = {}): DGNode {
    return {
      id: 'sg',
      type: 'subgraph',
      ports: { in: [{ name: 'data', required: true }], out: [{ name: 'score', required: true }] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
      meta: {
        subGraphConfig: {
          graphId: 'DG_FinancialCheck',
          inputMapping: { nif: 'company.nif' },
          outputMapping: { score: 'financialScore' },
        },
      },
      ...overrides,
    };
  }

  it('accepts a valid subgraph node', () => {
    const g: DGGraph = { id: 'g', version: '1.0.0', nodes: { sg: sgNode() }, edges: [] };
    expect(() => validateStructure(g)).not.toThrow();
  });

  it('rejects subgraph node with model', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { sg: sgNode({ model: 'FLAT_RATE' }) },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow(DGCompileError);
    expect(() => validateStructure(g)).toThrow('must not have a model');
  });

  it('rejects subgraph node missing subGraphConfig', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: { sg: sgNode({ meta: {} }) },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('missing meta.subGraphConfig');
  });

  it('rejects subgraph node with empty graphId', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        sg: sgNode({
          meta: {
            subGraphConfig: { graphId: '', inputMapping: {}, outputMapping: { v: 'v' } },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('graphId must be a non-empty string');
  });

  it('rejects subgraph node with empty outputMapping', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        sg: sgNode({
          meta: {
            subGraphConfig: { graphId: 'DG_X', inputMapping: {}, outputMapping: {} },
          },
        }),
      },
      edges: [],
    };
    expect(() => validateStructure(g)).toThrow('outputMapping is required');
  });
});
