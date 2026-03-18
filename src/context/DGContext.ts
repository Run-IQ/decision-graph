import {
  EvaluationContext,
  type EvaluationContextOptions,
  type ExecutionMeta,
  type PersistenceAdapter,
} from '@run-iq/context-engine';
import type { DGEvent, LogLevel, DGStatus } from '../types/events.js';
import type { DGResult, DGLevelSnapshot } from '../types/result.js';
import type { CompiledGraph } from '../types/compiled.js';
import { DGLimitError } from '../errors.js';
import { shouldLog } from './logLevels.js';
import { VERSION } from '../version.js';
import { EventEmitter } from 'node:events';

export interface DGContextOptions extends EvaluationContextOptions {
  logLevel?: LogLevel;
  streaming?: EventEmitter;
  onPersistenceError?: (error: unknown) => void;
  maxEvents?: number;
}

export class DGContext extends EvaluationContext {
  private readonly eventLog: DGEvent[] = [];
  private eventCount: number = 0;
  private readonly skippedNodes: Set<string> = new Set();
  private readonly failedNodes: Set<string> = new Set();
  private readonly completedNodes: Set<string> = new Set();
  private readonly inactiveEdges: Set<string> = new Set();
  private readonly levelStartTimes: Map<number, number> = new Map();
  private readonly dgOpts: DGContextOptions;

  constructor(
    input: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
    dgOptions: DGContextOptions = {},
  ) {
    const parentOpts: EvaluationContextOptions = {
      ...(dgOptions.limits !== undefined ? { limits: dgOptions.limits } : {}),
      ...(dgOptions.hooks !== undefined ? { hooks: dgOptions.hooks } : {}),
      ...(dgOptions.adapter !== undefined ? { adapter: dgOptions.adapter } : {}),
    };
    super(input, meta, parentOpts);
    this.dgOpts = dgOptions;
  }

  emit(event: DGEvent): void {
    const level = this.dgOpts.logLevel ?? 'standard';
    if (!shouldLog(event.type, level)) return;

    this.eventCount++;
    const maxEvents = this.dgOpts.maxEvents ?? 10_000;
    if (this.eventCount > maxEvents) {
      throw new DGLimitError(`maxEvents (${maxEvents}) exceeded`);
    }

    const frozenEvent = Object.freeze(event);
    this.eventLog.push(frozenEvent);

    // Streaming
    this.dgOpts.streaming?.emit('dg:event', frozenEvent);

    // Fire-and-forget persistence
    const adapter = this.dgOpts.adapter as PersistenceAdapter | undefined;
    if (adapter?.executions) {
      adapter.executions
        .recordEvent(this.meta.requestId, {
          executionId: this.meta.requestId,
          sequence: this.eventCount,
          type: event.type,
          payload: JSON.stringify(event),
          recordedAt: new Date().toISOString(),
        })
        .catch((err: unknown) => {
          this.dgOpts.onPersistenceError?.(err);
        });
    }

    // Track node/edge state
    if (event.type === 'node.skipped') this.skippedNodes.add(event.nodeId);
    if (event.type === 'node.failed') this.failedNodes.add(event.nodeId);
    if (event.type === 'node.completed') this.completedNodes.add(event.nodeId);
    if (event.type === 'edge.inactive') this.inactiveEdges.add(event.edgeId);
    if (event.type === 'level.started') this.levelStartTimes.set(event.level, Date.now());
  }

  isSkipped(nodeId: string): boolean {
    return this.skippedNodes.has(nodeId);
  }

  isFailed(nodeId: string): boolean {
    return this.failedNodes.has(nodeId);
  }

  isCompleted(nodeId: string): boolean {
    return this.completedNodes.has(nodeId);
  }

  isEdgeInactive(edgeId: string): boolean {
    return this.inactiveEdges.has(edgeId);
  }

  markCompleted(nodeId: string): void {
    this.completedNodes.add(nodeId);
  }

  markSkipped(nodeId: string): void {
    this.skippedNodes.add(nodeId);
  }

  markFailed(nodeId: string): void {
    this.failedNodes.add(nodeId);
  }

  getEvents(): readonly DGEvent[] {
    return [...this.eventLog];
  }

  levelSnapshot(level: number): DGLevelSnapshot {
    const startTime = this.levelStartTimes.get(level) ?? 0;
    const snap = this.snapshot(`after-level-${level}`);

    return {
      level,
      stateAtLevel: snap.state,
      events: this.eventLog.filter((e) => new Date(e.ts).getTime() >= startTime),
    };
  }

  buildResult(compiled: CompiledGraph): DGResult {
    const graphCompleted = this.eventLog.find(
      (e): e is Extract<DGEvent, { type: 'graph.completed' }> => e.type === 'graph.completed',
    );

    return {
      graphId: compiled.source.id,
      graphHash: compiled.hash,
      requestId: this.meta.requestId,
      status: graphCompleted?.status ?? ('failed' as DGStatus),
      outputs: this.getFullState(),
      executed: [...this.completedNodes],
      skipped: [...this.skippedNodes],
      failed: [...this.failedNodes],
      events: Object.freeze([...this.eventLog]),
      durationMs: graphCompleted?.durationMs ?? 0,
      versions: {
        dg: VERSION,
        contextEngine: compiled.compiled.contextEngineVersion,
        core: compiled.compiled.coreVersion,
      },
    };
  }
}
