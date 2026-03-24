import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';

export interface NodeResult {
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly raw?: unknown;
  readonly durationMs: number;
  /** When true, signals that fallback values were used instead of real outputs. */
  readonly usedFallback?: boolean;
}

export interface NodeExecutor {
  execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult>;
}
