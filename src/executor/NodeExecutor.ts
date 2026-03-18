import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';

export interface NodeResult {
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly raw?: unknown;
  readonly durationMs: number;
}

export interface NodeExecutor {
  execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult>;
}
