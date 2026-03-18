import { describe, it, expect } from 'vitest';
import { validateIdentifiers } from '../../../src/compiler/steps/step0-identifiers.js';
import { DGCompileError } from '../../../src/errors.js';
import type { DGGraph } from '../../../src/types/graph.js';

function minimalGraph(overrides: Partial<DGGraph> = {}): DGGraph {
  return {
    id: 'test-graph',
    version: '1.0.0',
    nodes: {},
    edges: [],
    ...overrides,
  };
}

function graphWithNode(nodeId: string): DGGraph {
  return {
    id: 'test-graph',
    version: '1.0.0',
    nodes: {
      [nodeId]: {
        id: nodeId,
        type: 'compute',
        model: 'FLAT_RATE',
        ports: { in: [], out: [] },
        policy: { onError: 'fail', onFailPropagation: 'halt' },
      },
    },
    edges: [],
  };
}

describe('step0-identifiers', () => {
  it('accepts valid identifiers', () => {
    const graph = graphWithNode('tax_calc');
    expect(() => validateIdentifiers(graph)).not.toThrow();
  });

  it('accepts alphanumeric with hyphens and underscores', () => {
    const graph = graphWithNode('node-1_A');
    expect(() => validateIdentifiers(graph)).not.toThrow();
  });

  it('rejects graph.id with dots', () => {
    const graph = minimalGraph({ id: 'my.graph' });
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });

  it('rejects graph.id with spaces', () => {
    const graph = minimalGraph({ id: 'my graph' });
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });

  it('rejects nodeId with special characters', () => {
    const graph = graphWithNode('tax$calc');
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });

  it('rejects mismatched node key and node.id', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        key_a: {
          id: 'key_b',
          type: 'compute',
          model: 'M',
          ports: { in: [], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        },
      },
      edges: [],
    };
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });

  it('rejects invalid port name', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        n: {
          id: 'n',
          type: 'compute',
          model: 'M',
          ports: { in: [{ name: 'bad.port', required: true }], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        },
      },
      edges: [],
    };
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });

  it('rejects invalid edge id', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1.0.0',
      nodes: {
        a: {
          id: 'a',
          type: 'compute',
          model: 'M',
          ports: { in: [], out: [{ name: 'v', required: false }] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        },
        b: {
          id: 'b',
          type: 'compute',
          model: 'M',
          ports: { in: [{ name: 'v', required: true }], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        },
      },
      edges: [{ id: 'bad edge!', from: { node: 'a', port: 'v' }, to: { node: 'b', port: 'v' } }],
    };
    expect(() => validateIdentifiers(graph)).toThrow(DGCompileError);
  });
});
