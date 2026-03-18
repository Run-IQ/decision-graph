import type { ContextLifecycleHooks, ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { DGResult } from '../types/result.js';
import type { CompiledGraph } from '../types/compiled.js';
import type { NodeResult } from '../executor/NodeExecutor.js';

export interface DGLifecycleHooks {
  beforeGraph?(compiled: CompiledGraph, meta: ExecutionMeta): Promise<void>;
  beforeNode?(node: DGNode, inputs: Record<string, unknown>): Promise<void>;
  afterNode?(node: DGNode, result: NodeResult): Promise<void>;
  afterGraph?(result: DGResult): Promise<void>;
  onError?(node: DGNode, error: Error): Promise<void>;
  contextHooks?: ContextLifecycleHooks;
}
