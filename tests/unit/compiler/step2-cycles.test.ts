import { describe, it, expect } from 'vitest';
import { detectCycles } from '../../../src/compiler/steps/step2-cycles.js';
import { DGCycleError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

describe('step2-cycles', () => {
  it('accepts empty graph', () => {
    expect(() => detectCycles({ id: 'g', version: '1', nodes: {}, edges: [] })).not.toThrow();
  });

  it('accepts linear DAG', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    expect(() => detectCycles(g)).not.toThrow();
  });

  it('accepts diamond DAG', () => {
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
    expect(() => detectCycles(g)).not.toThrow();
  });

  it('detects simple 2-node cycle', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
    };
    expect(() => detectCycles(g)).toThrow(DGCycleError);
  });

  it('detects 3-node cycle', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')],
    };
    expect(() => detectCycles(g)).toThrow(DGCycleError);
  });

  it('cycle error contains cycle path', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b'), c: node('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')],
    };
    try {
      detectCycles(g);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DGCycleError);
      expect((err as DGCycleError).cycle.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('detects self-loop', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a') },
      edges: [edge('e1', 'a', 'a')],
    };
    expect(() => detectCycles(g)).toThrow(DGCycleError);
  });

  it('accepts single node no edges', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a') },
      edges: [],
    };
    expect(() => detectCycles(g)).not.toThrow();
  });

  it('detects multiple independent cycles', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a'),
        b: node('b'),
        c: node('c'),
        d: node('d'),
        e: node('e'),
      },
      edges: [
        edge('e1', 'a', 'b'),
        edge('e2', 'b', 'a'),
        edge('e3', 'c', 'd'),
        edge('e4', 'd', 'e'),
        edge('e5', 'e', 'c'),
      ],
    };
    try {
      detectCycles(g);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(DGCycleError);
      const cycleErr = err as DGCycleError;
      expect(cycleErr.cycles.length).toBe(2);
      // First cycle should contain a,b or b,a
      const c1nodes = new Set(cycleErr.cycles[0]!.slice(0, -1));
      expect(c1nodes.has('a') || c1nodes.has('c')).toBe(true);
      // Second cycle should contain the other group
      const c2nodes = new Set(cycleErr.cycles[1]!.slice(0, -1));
      expect(c2nodes.has('a') || c2nodes.has('c')).toBe(true);
      // The two cycles cover different nodes
      expect((c1nodes.has('a') && c2nodes.has('c')) || (c1nodes.has('c') && c2nodes.has('a'))).toBe(
        true,
      );
    }
  });

  it('error message mentions all cycles', () => {
    const g: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a'), b: node('b') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'a')],
    };
    try {
      detectCycles(g);
      expect.fail('should have thrown');
    } catch (err) {
      const cycleErr = err as DGCycleError;
      expect(cycleErr.message).toContain('cycle(s) detected');
      // cycle property is backward-compatible (first cycle)
      expect(cycleErr.cycle.length).toBeGreaterThanOrEqual(2);
    }
  });
});
