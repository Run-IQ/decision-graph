import type { ExecutionMeta } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';
import { sleep } from '../utils.js';

export interface RetryRuleResolverOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
}

export class RetryRuleResolver implements RuleResolver {
  private readonly inner: RuleResolver;
  private readonly maxAttempts: number;
  private readonly baseDelayMs: number;

  constructor(inner: RuleResolver, options?: RetryRuleResolverOptions) {
    this.inner = inner;
    this.maxAttempts = options?.maxAttempts ?? 3;
    this.baseDelayMs = options?.baseDelayMs ?? 100;
  }

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.maxAttempts; attempt++) {
      try {
        return await this.inner.resolve(node, meta);
      } catch (err) {
        lastError = err;
        if (attempt < this.maxAttempts - 1) {
          await sleep(this.baseDelayMs * Math.pow(2, attempt));
        }
      }
    }
    throw lastError;
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    return this.inner.fingerprint(node, meta);
  }
}
