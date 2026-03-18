export interface NodePolicy {
  readonly onError: 'fail' | 'skip' | 'fallback';
  readonly fallback?: Readonly<Record<string, unknown>>;
  readonly timeout?: number;
  readonly onFailPropagation: 'halt' | 'skip-descendants' | 'continue';
  readonly storeRaw?: boolean;
  readonly maxOutputSizeKb?: number;
}

export interface MergeNodeConfig {
  readonly strategy: 'wait-all' | 'wait-any' | 'wait-quorum';
  readonly quorum?: number;
  readonly onPartialInputs: 'fail' | 'proceed-with-available' | 'use-defaults';
}

export interface ExecutionLimits {
  readonly maxNodes?: number;
  readonly maxDepth?: number;
  readonly maxEvents?: number;
  readonly maxDurationMs?: number;
  readonly maxParallelNodes?: number;
}

export const DEFAULT_LIMITS: Required<ExecutionLimits> = {
  maxNodes: 500,
  maxDepth: 50,
  maxEvents: 10_000,
  maxDurationMs: 30_000,
  maxParallelNodes: 20,
};
