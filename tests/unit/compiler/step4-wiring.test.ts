import { describe, it, expect } from 'vitest';
import { resolveWiring } from '../../../src/compiler/steps/step4-wiring.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string, inPorts: string[] = [], outPorts: string[] = []): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: {
      in: inPorts.map((name) => ({ name, required: true })),
      out: outPorts.map((name) => ({ name, required: true })),
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function edge(id: string, fromNode: string, fromPort: string, toNode: string, toPort: string) {
  return { id, from: { node: fromNode, port: fromPort }, to: { node: toNode, port: toPort } };
}

describe('step4-wiring', () => {
  it('returns empty map for empty graph', () => {
    const wiring = resolveWiring({ id: 'g', version: '1', nodes: {}, edges: [] });
    expect(wiring.size).toBe(0);
  });

  it('root node gets input.* wiring from ports', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', ['income', 'rate'], ['tax']) },
      edges: [],
    };
    const wiring = resolveWiring(g);
    const aWiring = wiring.get('a')!;
    expect(aWiring).toHaveLength(2);
    expect(aWiring[0]).toEqual({
      fromNode: 'input',
      fromPort: 'income',
      toNode: 'a',
      toPort: 'income',
    });
    expect(aWiring[1]).toEqual({
      fromNode: 'input',
      fromPort: 'rate',
      toNode: 'a',
      toPort: 'rate',
    });
  });

  it('edge creates wiring for target node', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['value']),
        b: node('b', ['value'], []),
      },
      edges: [edge('e1', 'a', 'value', 'b', 'value')],
    };
    const wiring = resolveWiring(g);
    expect(wiring.get('b')!).toHaveLength(1);
    expect(wiring.get('b')![0]).toEqual({
      fromNode: 'a',
      fromPort: 'value',
      toNode: 'b',
      toPort: 'value',
    });
    // 'a' is a root — gets input.* wiring (but has no input ports)
    expect(wiring.get('a')!).toHaveLength(0);
  });

  it('preserves portAlias as aliasedAs', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['tax']),
        b: node('b', ['amount'], []),
      },
      edges: [
        {
          id: 'e1',
          from: { node: 'a', port: 'tax' },
          to: { node: 'b', port: 'amount' },
          portAlias: 'taxAmount',
        },
      ],
    };
    const wiring = resolveWiring(g);
    expect(wiring.get('b')![0]!.aliasedAs).toBe('taxAmount');
  });

  it('non-root node does not get input.* wiring', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['value']),
        b: node('b', ['value', 'extra'], []),
      },
      edges: [edge('e1', 'a', 'value', 'b', 'value')],
    };
    const wiring = resolveWiring(g);
    // b has edge wiring, so it's not a root — no input.* wiring added
    expect(wiring.get('b')!).toHaveLength(1);
  });

  it('multiple edges into same node', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['x']),
        b: node('b', [], ['y']),
        c: node('c', ['x', 'y'], []),
      },
      edges: [edge('e1', 'a', 'x', 'c', 'x'), edge('e2', 'b', 'y', 'c', 'y')],
    };
    const wiring = resolveWiring(g);
    expect(wiring.get('c')!).toHaveLength(2);
  });

  it('all nodes have a wiring entry', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['v']),
        b: node('b', ['v'], ['w']),
        c: node('c', ['w'], []),
      },
      edges: [edge('e1', 'a', 'v', 'b', 'v'), edge('e2', 'b', 'w', 'c', 'w')],
    };
    const wiring = resolveWiring(g);
    expect(wiring.has('a')).toBe(true);
    expect(wiring.has('b')).toBe(true);
    expect(wiring.has('c')).toBe(true);
  });
});
