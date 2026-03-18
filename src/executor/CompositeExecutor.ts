import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { NodeExecutor, NodeResult } from './NodeExecutor.js';

/**
 * Routes node execution to the appropriate executor based on node type.
 *
 * - `'enrich'` nodes → `httpExecutor`
 * - all other types  → `coreExecutor`
 */
export class CompositeExecutor implements NodeExecutor {
  constructor(
    private readonly coreExecutor: NodeExecutor,
    private readonly httpExecutor: NodeExecutor,
  ) {}

  async execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult> {
    if (node.type === 'enrich') {
      return this.httpExecutor.execute(node, inputs, meta);
    }
    return this.coreExecutor.execute(node, inputs, meta);
  }
}
