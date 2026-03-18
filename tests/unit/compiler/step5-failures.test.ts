import { describe, it, expect } from 'vitest';
import { buildFailurePropagationMap } from '../../../src/compiler/steps/step5-failures.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string, propagation: 'halt' | 'skip-descendants' | 'continue' = 'halt'): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError: 'fail', onFailPropagation: propagation },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

describe('step5-failures', () => {
  it('returns empty map for empty graph', () => {
    const map = buildFailurePropagationMap({ id: 'g', version: '1', nodes: {}, edges: [] });
    expect(map.size).toBe(0);
  });

  it('leaf node has no descendants', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a') },
      edges: [],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.get('a')!.descendants).toEqual([]);
    expect(map.get('a')!.policy).toBe('halt');
  });

  it('stores correct policy per node', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', 'skip-descendants'),
        b: node('b', 'continue'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.get('a')!.policy).toBe('skip-descendants');
    expect(map.get('b')!.policy).toBe('continue');
  });

  it('finds direct descendants', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'a', 'c')],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.get('a')!.descendants.sort()).toEqual(['b', 'c']);
  });

  it('finds transitive descendants', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.get('a')!.descendants.sort()).toEqual(['b', 'c']);
    expect(map.get('b')!.descendants).toEqual(['c']);
    expect(map.get('c')!.descendants).toEqual([]);
  });

  it('handles diamond correctly', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c'), d: node('d') },
      edges: [
        edge('e1', 'a', 'b'),
        edge('e2', 'a', 'c'),
        edge('e3', 'b', 'd'),
        edge('e4', 'c', 'd'),
      ],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.get('a')!.descendants.sort()).toEqual(['b', 'c', 'd']);
    expect(map.get('b')!.descendants).toEqual(['d']);
    expect(map.get('c')!.descendants).toEqual(['d']);
  });

  it('each node has an entry', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const map = buildFailurePropagationMap(g);
    expect(map.size).toBe(2);
  });
});
