import { describe, it, expect } from 'vitest';
import { topologicalSort } from '../../../src/compiler/steps/step3-toposort.js';
import { DGLimitError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string, type: 'compute' | 'merge' = 'compute'): DGNode {
  return {
    id,
    type,
    model: type === 'compute' ? 'M' : undefined,
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

describe('step3-toposort', () => {
  it('returns empty for empty graph', () => {
    const levels = topologicalSort({ id: 'g', version: '1', nodes: {}, edges: [] });
    expect(levels).toEqual([]);
  });

  it('single node produces one level', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a') },
      edges: [],
    };
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(1);
    expect(levels[0]!.nodes).toEqual(['a']);
    expect(levels[0]!.mergeNodes).toEqual([]);
  });

  it('linear chain produces N levels', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(3);
    expect(levels[0]!.nodes).toEqual(['a']);
    expect(levels[1]!.nodes).toEqual(['b']);
    expect(levels[2]!.nodes).toEqual(['c']);
  });

  it('parallel nodes are in same level', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
    };
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.nodes.sort()).toEqual(['a', 'b']);
    expect(levels[1]!.nodes).toEqual(['c']);
  });

  it('merge nodes go to mergeNodes array', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), m: node('m', 'merge') },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(2);
    expect(levels[0]!.nodes.sort()).toEqual(['a', 'b']);
    expect(levels[1]!.mergeNodes).toEqual(['m']);
    expect(levels[1]!.nodes).toEqual([]);
  });

  it('diamond DAG produces correct levels', () => {
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
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(3);
    expect(levels[0]!.nodes).toEqual(['a']);
    expect(levels[1]!.nodes.sort()).toEqual(['b', 'c']);
    expect(levels[2]!.nodes).toEqual(['d']);
  });

  it('throws when maxNodes exceeded', () => {
    const nodes: Record<string, DGNode> = {};
    for (let i = 0; i < 10; i++) {
      const id = `n${i}`;
      nodes[id] = node(id);
    }
    const g: DGGraph = { id: 'g', version: '1', nodes, edges: [] };
    expect(() => topologicalSort(g, { maxNodes: 5 })).toThrow(DGLimitError);
  });

  it('throws when maxDepth exceeded', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c'), d: node('d') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'd')],
    };
    expect(() => topologicalSort(g, { maxDepth: 2 })).toThrow(DGLimitError);
  });

  it('disconnected nodes all appear at level 0', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [],
    };
    const levels = topologicalSort(g);
    expect(levels).toHaveLength(1);
    expect(levels[0]!.nodes.sort()).toEqual(['a', 'b', 'c']);
  });

  it('respects default limits for large graphs', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a') },
      edges: [],
    };
    // Should not throw with defaults
    expect(() => topologicalSort(g)).not.toThrow();
  });
});
