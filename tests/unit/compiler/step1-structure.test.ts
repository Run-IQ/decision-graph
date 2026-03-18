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
});
