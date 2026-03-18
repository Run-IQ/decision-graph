import { describe, it, expect, vi } from 'vitest';
import { RuleStoreResolver } from '../../../src/resolver/RuleStoreResolver.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta, SerializedRule } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: '2025-06-15T00:00:00Z',
  effectiveDate: '2025-06-15',
};

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'FLAT_RATE',
    ports: { in: [], out: [] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function serializedRule(id: string): SerializedRule {
  return {
    id,
    version: 1,
    model: 'FLAT_RATE',
    tenantId: 'tenant-1',
    scope: 'GLOBAL',
    status: 'PUBLISHED',
    effectiveFrom: '2025-01-01',
    effectiveUntil: null,
    priority: 100,
    tags: ['fiscal'],
    checksum: 'abc123',
    payload: JSON.stringify({ params: { rate: 0.1, base: 'income' } }),
    createdBy: 'system',
    createdAt: '2025-01-01',
    updatedAt: '2025-01-01',
  };
}

function makeMockStore() {
  return {
    resolveRules: vi.fn().mockResolvedValue([serializedRule('r1')]),
    fingerprint: vi.fn().mockReturnValue('fp-hash'),
    getRule: vi.fn(),
    listRules: vi.fn(),
    getRuleHistory: vi.fn(),
    getRulesAtDate: vi.fn(),
    saveRule: vi.fn(),
    updateRuleStatus: vi.fn(),
    deleteRule: vi.fn(),
  };
}

describe('RuleStoreResolver', () => {
  it('resolves rules from store', async () => {
    const store = makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('r1');
    expect(rules[0]!.model).toBe('FLAT_RATE');
  });

  it('converts SerializedRule to Rule', async () => {
    const store = makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules[0]!.effectiveFrom).toBeInstanceOf(Date);
    expect(rules[0]!.params).toEqual({ rate: 0.1, base: 'income' });
  });

  it('passes correct query to store', async () => {
    const store = makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    await resolver.resolve(node('n'), META);
    expect(store.resolveRules).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      model: 'FLAT_RATE',
      effectiveDate: '2025-06-15',
      nodeId: 'n',
    });
  });

  it('returns fingerprint from store', () => {
    const store = makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    expect(resolver.fingerprint(node('n'), META)).toBe('fp-hash');
  });

  it('uses timestamp when effectiveDate missing', async () => {
    const store = makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    const metaNoDate: ExecutionMeta = { requestId: 'r', tenantId: 't', timestamp: '2025-03-01' };
    await resolver.resolve(node('n'), metaNoDate);
    expect(store.resolveRules).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: '2025-03-01' }),
    );
  });

  it('handles effectiveUntil', async () => {
    const store = makeMockStore();
    store.resolveRules.mockResolvedValue([
      { ...serializedRule('r1'), effectiveUntil: '2025-12-31' },
    ]);
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules[0]!.effectiveUntil).toBeInstanceOf(Date);
  });
});
