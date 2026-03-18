import { describe, it, expect, vi } from 'vitest';
import { CachedRuleResolver } from '../../../src/resolver/CachedRuleResolver.js';
import { RetryRuleResolver } from '../../../src/resolver/RetryRuleResolver.js';
import { TimeoutRuleResolver } from '../../../src/resolver/TimeoutRuleResolver.js';
import { CompositeRuleResolver } from '../../../src/resolver/CompositeRuleResolver.js';
import { DGTimeoutError } from '../../../src/errors.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { RuleResolver } from '../../../src/resolver/RuleResolver.js';
import type { Rule } from '@run-iq/core';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [], out: [] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function makeRule(id: string): Rule {
  return {
    id,
    version: 1,
    model: 'M',
    params: {},
    priority: 100,
    effectiveFrom: new Date(),
    effectiveUntil: null,
    tags: [],
    checksum: 'abc',
  };
}

function mockResolver(rules: Rule[] = [makeRule('r1')]): RuleResolver {
  return {
    resolve: vi.fn().mockResolvedValue(rules),
    fingerprint: vi.fn().mockReturnValue('fp-1'),
  };
}

describe('CachedRuleResolver', () => {
  it('caches results', async () => {
    const inner = mockResolver();
    const cached = new CachedRuleResolver(inner, { ttlMs: 5000 });

    await cached.resolve(node('n'), META);
    await cached.resolve(node('n'), META);

    expect(inner.resolve).toHaveBeenCalledTimes(1);
  });

  it('evicts expired entries', async () => {
    const inner = mockResolver();
    const cached = new CachedRuleResolver(inner, { ttlMs: 1 });

    await cached.resolve(node('n'), META);
    await new Promise((r) => setTimeout(r, 10));
    await cached.resolve(node('n'), META);

    expect(inner.resolve).toHaveBeenCalledTimes(2);
  });

  it('evicts LRU when full', async () => {
    const inner = mockResolver();
    const cached = new CachedRuleResolver(inner, { maxEntries: 1, ttlMs: 5000 });

    // Different fingerprints
    (inner.fingerprint as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce('fp-1')
      .mockReturnValueOnce('fp-2')
      .mockReturnValueOnce('fp-1');

    await cached.resolve(node('a'), META);
    await cached.resolve(node('b'), META);
    await cached.resolve(node('a'), META);

    expect(inner.resolve).toHaveBeenCalledTimes(3);
  });

  it('clear empties cache', async () => {
    const inner = mockResolver();
    const cached = new CachedRuleResolver(inner, { ttlMs: 5000 });

    await cached.resolve(node('n'), META);
    cached.clear();
    await cached.resolve(node('n'), META);

    expect(inner.resolve).toHaveBeenCalledTimes(2);
  });
});

describe('RetryRuleResolver', () => {
  it('returns on first success', async () => {
    const inner = mockResolver();
    const retry = new RetryRuleResolver(inner, { maxAttempts: 3, baseDelayMs: 1 });

    const result = await retry.resolve(node('n'), META);
    expect(result).toHaveLength(1);
    expect(inner.resolve).toHaveBeenCalledTimes(1);
  });

  it('retries on failure', async () => {
    const inner = mockResolver();
    (inner.resolve as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce([makeRule('r1')]);

    const retry = new RetryRuleResolver(inner, { maxAttempts: 3, baseDelayMs: 1 });
    const result = await retry.resolve(node('n'), META);

    expect(result).toHaveLength(1);
    expect(inner.resolve).toHaveBeenCalledTimes(2);
  });

  it('throws after max attempts', async () => {
    const inner = mockResolver();
    (inner.resolve as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('permanent'));

    const retry = new RetryRuleResolver(inner, { maxAttempts: 2, baseDelayMs: 1 });
    await expect(retry.resolve(node('n'), META)).rejects.toThrow('permanent');
    expect(inner.resolve).toHaveBeenCalledTimes(2);
  });

  it('delegates fingerprint', () => {
    const inner = mockResolver();
    const retry = new RetryRuleResolver(inner);
    expect(retry.fingerprint(node('n'), META)).toBe('fp-1');
  });
});

describe('TimeoutRuleResolver', () => {
  it('resolves within timeout', async () => {
    const inner = mockResolver();
    const timeout = new TimeoutRuleResolver(inner, 1000);
    const result = await timeout.resolve(node('n'), META);
    expect(result).toHaveLength(1);
  });

  it('throws DGTimeoutError when exceeded', async () => {
    const inner: RuleResolver = {
      resolve: vi
        .fn()
        .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([]), 200))),
      fingerprint: vi.fn().mockReturnValue('fp'),
    };
    const timeout = new TimeoutRuleResolver(inner, 10);
    await expect(timeout.resolve(node('n'), META)).rejects.toThrow(DGTimeoutError);
  });

  it('delegates fingerprint', () => {
    const inner = mockResolver();
    const timeout = new TimeoutRuleResolver(inner, 1000);
    expect(timeout.fingerprint(node('n'), META)).toBe('fp-1');
  });
});

describe('CompositeRuleResolver', () => {
  it('merges results from multiple resolvers', async () => {
    const r1 = mockResolver([makeRule('r1')]);
    const r2 = mockResolver([makeRule('r2')]);
    const composite = new CompositeRuleResolver([r1, r2]);

    const result = await composite.resolve(node('n'), META);
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('returns empty when all empty', async () => {
    const r1 = mockResolver([]);
    const composite = new CompositeRuleResolver([r1]);
    const result = await composite.resolve(node('n'), META);
    expect(result).toEqual([]);
  });

  it('produces deterministic fingerprint', () => {
    const r1 = mockResolver();
    const r2 = mockResolver();
    const composite = new CompositeRuleResolver([r1, r2]);
    const f1 = composite.fingerprint(node('n'), META);
    const f2 = composite.fingerprint(node('n'), META);
    expect(f1).toBe(f2);
  });
});
