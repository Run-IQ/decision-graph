import { describe, it, expect } from 'vitest';
import { computeGraphHash } from '../../../src/compiler/steps/step7-hash.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [], out: [{ name: 'v', required: true }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function minGraph(): DGGraph {
  return {
    id: 'g',
    version: '1.0.0',
    nodes: { a: node('a') },
    edges: [],
  };
}

describe('step7-hash', () => {
  it('returns a string', () => {
    expect(typeof computeGraphHash(minGraph())).toBe('string');
  });

  it('returns a 64-char hex string (SHA-256)', () => {
    const hash = computeGraphHash(minGraph());
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('same graph produces same hash (deterministic)', () => {
    const h1 = computeGraphHash(minGraph());
    const h2 = computeGraphHash(minGraph());
    expect(h1).toBe(h2);
  });

  it('different version produces different hash', () => {
    const g1 = minGraph();
    const g2 = { ...minGraph(), version: '2.0.0' };
    expect(computeGraphHash(g1)).not.toBe(computeGraphHash(g2));
  });

  it('different nodes produce different hash', () => {
    const g1 = minGraph();
    const g2: DGGraph = { ...minGraph(), nodes: { a: node('a'), b: node('b') } };
    expect(computeGraphHash(g1)).not.toBe(computeGraphHash(g2));
  });

  it('meta is excluded from hash', () => {
    const g1 = minGraph();
    const g2: DGGraph = { ...minGraph(), meta: { description: 'test', domain: 'fiscal' } };
    expect(computeGraphHash(g1)).toBe(computeGraphHash(g2));
  });
});
