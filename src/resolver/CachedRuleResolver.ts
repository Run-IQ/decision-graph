import type { ExecutionMeta } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';

interface CacheEntry {
  rules: Rule[];
  expiresAt: number;
}

export interface CachedRuleResolverOptions {
  readonly maxEntries?: number;
  readonly ttlMs?: number;
}

export class CachedRuleResolver implements RuleResolver {
  private readonly inner: RuleResolver;
  private readonly cache: Map<string, CacheEntry> = new Map();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(inner: RuleResolver, options?: CachedRuleResolverOptions) {
    this.inner = inner;
    this.maxEntries = options?.maxEntries ?? 100;
    this.ttlMs = options?.ttlMs ?? 60_000;
  }

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    const key = this.inner.fingerprint(node, meta);
    const cached = this.cache.get(key);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.rules;
    }

    const rules = await this.inner.resolve(node, meta);

    // Evict oldest if full
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value as string;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { rules, expiresAt: Date.now() + this.ttlMs });
    return rules;
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    return this.inner.fingerprint(node, meta);
  }

  clear(): void {
    this.cache.clear();
  }
}
