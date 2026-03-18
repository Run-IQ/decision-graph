import type { ExecutionMeta } from '@run-iq/context-engine';
import { sha256 } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';

export class CompositeRuleResolver implements RuleResolver {
  private readonly resolvers: readonly RuleResolver[];

  constructor(resolvers: readonly RuleResolver[]) {
    this.resolvers = resolvers;
  }

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    const results = await Promise.all(this.resolvers.map((r) => r.resolve(node, meta)));
    return results.flat();
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    const fingerprints = this.resolvers.map((r) => r.fingerprint(node, meta));
    return sha256(fingerprints.join(':'));
  }
}
