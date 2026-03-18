import type { ExecutionMeta, RuleStore, SerializedRule, RuleQuery } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';

function toRule(sr: SerializedRule): Rule {
  const payload = JSON.parse(sr.payload) as {
    params: unknown;
    condition?: { dsl: string; value: unknown };
  };
  return {
    id: sr.id,
    version: sr.version,
    model: sr.model,
    params: payload.params,
    condition: payload.condition,
    priority: sr.priority,
    effectiveFrom: new Date(sr.effectiveFrom),
    effectiveUntil: sr.effectiveUntil ? new Date(sr.effectiveUntil) : null,
    tags: [...sr.tags],
    checksum: sr.checksum,
  };
}

export class RuleStoreResolver implements RuleResolver {
  constructor(private readonly store: RuleStore) {}

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    const query: RuleQuery = {
      tenantId: meta.tenantId,
      ...(node.model !== undefined ? { model: node.model } : {}),
      effectiveDate: meta.effectiveDate ?? meta.timestamp,
      nodeId: node.id,
    };
    const serialized = await this.store.resolveRules(query);
    return serialized.map(toRule);
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    const query: RuleQuery = {
      tenantId: meta.tenantId,
      ...(node.model !== undefined ? { model: node.model } : {}),
      effectiveDate: meta.effectiveDate ?? meta.timestamp,
      nodeId: node.id,
    };
    return this.store.fingerprint(query);
  }
}
