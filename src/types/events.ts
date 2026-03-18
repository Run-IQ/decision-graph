export type DGEvent =
  | {
      readonly type: 'graph.started';
      readonly graphId: string;
      readonly hash: string;
      readonly requestId: string;
      readonly ts: string;
    }
  | {
      readonly type: 'level.started';
      readonly level: number;
      readonly nodes: readonly string[];
      readonly mergeNodes: readonly string[];
      readonly ts: string;
    }
  | {
      readonly type: 'node.started';
      readonly nodeId: string;
      readonly nodeExecutionId: string;
      readonly inputs: Readonly<Record<string, unknown>>;
      readonly ts: string;
    }
  | {
      readonly type: 'node.completed';
      readonly nodeId: string;
      readonly nodeExecutionId: string;
      readonly outputs: Readonly<Record<string, unknown>>;
      readonly durationMs: number;
      readonly ts: string;
    }
  | {
      readonly type: 'node.raw_stored';
      readonly nodeId: string;
      readonly sizeKb: number;
      readonly ts: string;
    }
  | {
      readonly type: 'node.skipped';
      readonly nodeId: string;
      readonly reason: SkipReason;
      readonly ts: string;
    }
  | {
      readonly type: 'node.failed';
      readonly nodeId: string;
      readonly nodeExecutionId: string;
      readonly error: string;
      readonly propagation: string;
      readonly ts: string;
    }
  | {
      readonly type: 'node.fallback';
      readonly nodeId: string;
      readonly fallback: Readonly<Record<string, unknown>>;
      readonly ts: string;
    }
  | {
      readonly type: 'edge.inactive';
      readonly edgeId: string;
      readonly scope: string;
      readonly evaluated: unknown;
      readonly ts: string;
    }
  | {
      readonly type: 'merge.waiting';
      readonly nodeId: string;
      readonly strategy: string;
      readonly waiting: readonly string[];
      readonly received: readonly string[];
      readonly ts: string;
    }
  | {
      readonly type: 'level.completed';
      readonly level: number;
      readonly durationMs: number;
      readonly ts: string;
    }
  | {
      readonly type: 'graph.completed';
      readonly status: DGStatus;
      readonly durationMs: number;
      readonly ts: string;
    };

export type SkipReason =
  | 'edge-condition-false'
  | 'parent-failed-propagation'
  | 'guard-rejected'
  | 'merge-partial-inputs-failed'
  | 'timeout';

export type DGStatus = 'completed' | 'failed' | 'partial';

export type LogLevel = 'minimal' | 'standard' | 'verbose';
