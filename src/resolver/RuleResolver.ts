import type { ExecutionMeta } from '@run-iq/context-engine';
import type { Rule } from '@run-iq/core';
import type { DGNode } from '../types/graph.js';

export interface RuleResolver {
  resolve(node: DGNode, meta: ExecutionMeta): Promise<Rule[]>;
  fingerprint(node: DGNode, meta: ExecutionMeta): string;
}
