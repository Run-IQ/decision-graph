import type { DGEvent, DGStatus } from './events.js';

export interface DGResult {
  readonly graphId: string;
  readonly graphHash: string;
  readonly requestId: string;
  readonly status: DGStatus;
  readonly outputs: Readonly<Record<string, unknown>>;
  readonly executed: readonly string[];
  readonly skipped: readonly string[];
  readonly failed: readonly string[];
  readonly events: readonly DGEvent[];
  readonly durationMs: number;
  readonly versions: {
    readonly dg: string;
    readonly contextEngine: string;
    readonly core: string;
  };
}

export interface DGLevelSnapshot {
  readonly level: number;
  readonly stateAtLevel: Readonly<Record<string, unknown>>;
  readonly events: readonly DGEvent[];
}
