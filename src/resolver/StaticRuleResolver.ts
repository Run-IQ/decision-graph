import type { ExecutionMeta } from '@run-iq/context-engine';
import { sha256 } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';
import type { RuleResolver } from './RuleResolver.js';

export class StaticRuleResolver implements RuleResolver {
  private readonly rulesMap: Map<string, Rule[]>;

  constructor(rulesMap: Map<string, Rule[]>) {
    this.rulesMap = rulesMap;
  }

  async resolve(node: DGNode, _meta: ExecutionMeta): Promise<Rule[]> {
    return this.rulesMap.get(node.id) ?? [];
  }

  fingerprint(node: DGNode, _meta: ExecutionMeta): string {
    const rules = this.rulesMap.get(node.id) ?? [];
    return sha256(JSON.stringify(rules.map((r) => r.id + ':' + String(r.version))));
  }
}
