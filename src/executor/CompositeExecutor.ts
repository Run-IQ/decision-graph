import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { NodeExecutor, NodeResult } from './NodeExecutor.js';

/**
 * Routes node execution to the appropriate executor based on node type.
 *
 * - `'enrich'`   nodes → `httpExecutor`
 * - `'subgraph'` nodes → `subGraphExecutor`
 * - all other types    → `coreExecutor`
 */
export class CompositeExecutor implements NodeExecutor {
  constructor(
    private readonly coreExecutor: NodeExecutor,
    private readonly httpExecutor: NodeExecutor,
    private readonly subGraphExecutor?: NodeExecutor,
  ) {}

  async execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult> {
    if (node.type === 'enrich') {
      return this.httpExecutor.execute(node, inputs, meta);
    }
    if (node.type === 'subgraph') {
      if (!this.subGraphExecutor) {
        throw new Error(
          `CompositeExecutor: node "${node.id}" is type "subgraph" but no SubGraphExecutor was provided`,
        );
      }
      return this.subGraphExecutor.execute(node, inputs, meta);
    }
    return this.coreExecutor.execute(node, inputs, meta);
  }
}
