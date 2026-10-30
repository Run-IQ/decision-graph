import type { ExecutionMeta, RuleStore, RuleQuery } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import { fromStoredRecord } from '@run-iq/spec';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';

/**
 * Resolves the rules of a node from a `RuleStore`. Each stored record is rebuilt with
 * `fromStoredRecord` from `@run-iq/spec`, which checks that the payload is canonical and
 * matches its checksum. A record that fails the check is never dropped: `resolve` rejects with
 * the `SpecError` (`INVALID_RULE`, naming the rule as `id@version`), so the node fails under
 * its `onError` policy.
 */
export class RuleStoreResolver implements RuleResolver {
  constructor(private readonly store: RuleStore) {}

  async resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]> {
    const serialized = await this.store.resolveRules(this.query(node, meta));
    return serialized.map((record) => fromStoredRecord(record));
  }

  fingerprint(node: DGNode, meta: ExecutionMeta): string {
    return this.store.fingerprint(this.query(node, meta));
  }

  private query(node: DGNode, meta: ExecutionMeta): RuleQuery {
    return {
      tenantId: meta.tenantId,
      ...(node.model !== undefined ? { model: node.model } : {}),
      effectiveDate: meta.effectiveDate ?? meta.timestamp,
      nodeId: node.id,
    };
  }
}
