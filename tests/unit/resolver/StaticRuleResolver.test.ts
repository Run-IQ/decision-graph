import { describe, it, expect } from 'vitest';
import { StaticRuleResolver } from '../../../src/resolver/StaticRuleResolver.js';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function makeRule(id: string): Rule {
  return {
    id,
    version: 1,
    model: 'FLAT_RATE',
    params: { rate: 0.1, base: 'income' },
    priority: 100,
    effectiveFrom: new Date('2025-01-01'),
    effectiveUntil: null,
    tags: [],
    checksum: 'abc123',
  };
}

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'FLAT_RATE',
    ports: { in: [], out: [] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

describe('StaticRuleResolver', () => {
  it('resolves rules for a known node', async () => {
    const rules = [makeRule('r1'), makeRule('r2')];
    const resolver = new StaticRuleResolver(new Map([['a', rules]]));
    const result = await resolver.resolve(node('a'), META);
    expect(result).toHaveLength(2);
  });

  it('returns empty for unknown node', async () => {
    const resolver = new StaticRuleResolver(new Map());
    const result = await resolver.resolve(node('unknown'), META);
    expect(result).toEqual([]);
  });

  it('returns deterministic fingerprint', () => {
    const rules = [makeRule('r1')];
    const resolver = new StaticRuleResolver(new Map([['a', rules]]));
    const f1 = resolver.fingerprint(node('a'), META);
    const f2 = resolver.fingerprint(node('a'), META);
    expect(f1).toBe(f2);
    expect(f1).toMatch(/^[a-f0-9]{64}$/);
  });

  it('different rules produce different fingerprints', () => {
    const resolver1 = new StaticRuleResolver(new Map([['a', [makeRule('r1')]]]));
    const resolver2 = new StaticRuleResolver(new Map([['a', [makeRule('r2')]]]));
    expect(resolver1.fingerprint(node('a'), META)).not.toBe(resolver2.fingerprint(node('a'), META));
  });
});
