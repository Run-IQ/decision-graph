import { describe, it, expect, vi } from 'vitest';
import { DGContext } from '../../../src/context/DGContext.js';
import { DGLimitError } from '../../../src/errors.js';
import type { DGEvent } from '../../../src/types/events.js';
import type { CompiledGraph } from '../../../src/types/compiled.js';
import { EventEmitter } from 'node:events';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function makeCompiled(): CompiledGraph {
  return {
    source: { id: 'g', version: '1', nodes: {}, edges: [] },
    levels: [],
    wiring: new Map(),
    failures: new Map(),
    dslVars: new Map(),
    warnings: [],
    hash: 'abc123'.padEnd(64, '0'),
    compiled: {
      at: new Date().toISOString(),
      dgVersion: '0.1.0',
      contextEngineVersion: '0.2.0',
      coreVersion: '0.2.6',
    },
  };
}

describe('DGContext', () => {
  describe('inheritance from EvaluationContext', () => {
    it('stores input in input.* namespace', () => {
      const ctx = new DGContext({ income: 1000 }, META);
      expect(ctx.get('input.income')).toBe(1000);
    });

    it('set/get works for node outputs', () => {
      const ctx = new DGContext({}, META);
      ctx.set('nodeA', 'value', 42);
      expect(ctx.get('nodeA.value')).toBe(42);
    });

    it('getNodeOutputs returns all outputs of a node', () => {
      const ctx = new DGContext({}, META);
      ctx.set('nodeA', 'x', 1);
      ctx.set('nodeA', 'y', 2);
      expect(ctx.getNodeOutputs('nodeA')).toEqual({ x: 1, y: 2 });
    });

    it('getFullState returns complete state', () => {
      const ctx = new DGContext({ a: 1 }, META);
      ctx.set('n', 'v', 2);
      const state = ctx.getFullState();
      expect(state['input.a']).toBe(1);
      expect(state['n.v']).toBe(2);
    });

    it('snapshot creates a snapshot', () => {
      const ctx = new DGContext({ a: 1 }, META);
      const snap = ctx.snapshot('test');
      expect(snap.label).toBe('test');
      expect(snap.state['input.a']).toBe(1);
    });

    it('has checks key existence', () => {
      const ctx = new DGContext({ a: 1 }, META);
      expect(ctx.has('input.a')).toBe(true);
      expect(ctx.has('input.b')).toBe(false);
    });
  });

  describe('event emission', () => {
    it('emits and stores events', () => {
      const ctx = new DGContext({}, META);
      const event: DGEvent = {
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'r',
        ts: new Date().toISOString(),
      };
      ctx.emit(event);
      expect(ctx.getEvents()).toHaveLength(1);
      expect(ctx.getEvents()[0]!.type).toBe('graph.started');
    });

    it('filters events by log level', () => {
      const ctx = new DGContext({}, META, { logLevel: 'minimal' });
      ctx.emit({
        type: 'node.started',
        nodeId: 'n',
        nodeExecutionId: 'ne',
        inputs: {},
        ts: new Date().toISOString(),
      });
      expect(ctx.getEvents()).toHaveLength(0);
    });

    it('tracks skipped nodes', () => {
      const ctx = new DGContext({}, META, { logLevel: 'verbose' });
      ctx.emit({
        type: 'node.skipped',
        nodeId: 'n',
        reason: 'timeout',
        ts: new Date().toISOString(),
      });
      expect(ctx.isSkipped('n')).toBe(true);
    });

    it('tracks failed nodes', () => {
      const ctx = new DGContext({}, META, { logLevel: 'verbose' });
      ctx.emit({
        type: 'node.failed',
        nodeId: 'n',
        nodeExecutionId: 'ne',
        error: 'err',
        propagation: 'halt',
        ts: new Date().toISOString(),
      });
      expect(ctx.isFailed('n')).toBe(true);
    });

    it('tracks completed nodes via emit', () => {
      const ctx = new DGContext({}, META);
      ctx.emit({
        type: 'node.completed',
        nodeId: 'n',
        nodeExecutionId: 'ne',
        outputs: {},
        durationMs: 10,
        ts: new Date().toISOString(),
      });
      expect(ctx.isCompleted('n')).toBe(true);
    });

    it('tracks inactive edges', () => {
      const ctx = new DGContext({}, META, { logLevel: 'verbose' });
      ctx.emit({
        type: 'edge.inactive',
        edgeId: 'e1',
        scope: 'source-output',
        evaluated: false,
        ts: new Date().toISOString(),
      });
      expect(ctx.isEdgeInactive('e1')).toBe(true);
    });

    it('throws when maxEvents exceeded', () => {
      const ctx = new DGContext({}, META, { maxEvents: 2 });
      ctx.emit({
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'r',
        ts: new Date().toISOString(),
      });
      ctx.emit({
        type: 'graph.completed',
        status: 'completed',
        durationMs: 10,
        ts: new Date().toISOString(),
      });
      expect(() =>
        ctx.emit({
          type: 'graph.started',
          graphId: 'g',
          hash: 'h',
          requestId: 'r',
          ts: new Date().toISOString(),
        }),
      ).toThrow(DGLimitError);
    });

    it('freezes emitted events', () => {
      const ctx = new DGContext({}, META);
      ctx.emit({
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'r',
        ts: new Date().toISOString(),
      });
      const event = ctx.getEvents()[0]!;
      expect(Object.isFrozen(event)).toBe(true);
    });
  });

  describe('streaming', () => {
    it('streams events to EventEmitter', () => {
      const emitter = new EventEmitter();
      const received: DGEvent[] = [];
      emitter.on('dg:event', (e: DGEvent) => received.push(e));

      const ctx = new DGContext({}, META, { streaming: emitter });
      ctx.emit({
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'r',
        ts: new Date().toISOString(),
      });
      expect(received).toHaveLength(1);
    });

    it('does not stream filtered events', () => {
      const emitter = new EventEmitter();
      const received: DGEvent[] = [];
      emitter.on('dg:event', (e: DGEvent) => received.push(e));

      const ctx = new DGContext({}, META, { streaming: emitter, logLevel: 'minimal' });
      ctx.emit({
        type: 'node.started',
        nodeId: 'n',
        nodeExecutionId: 'ne',
        inputs: {},
        ts: new Date().toISOString(),
      });
      expect(received).toHaveLength(0);
    });

    it('works without streaming option', () => {
      const ctx = new DGContext({}, META);
      expect(() =>
        ctx.emit({
          type: 'graph.started',
          graphId: 'g',
          hash: 'h',
          requestId: 'r',
          ts: new Date().toISOString(),
        }),
      ).not.toThrow();
    });
  });

  describe('markCompleted / markSkipped / markFailed', () => {
    it('markCompleted tracks completion', () => {
      const ctx = new DGContext({}, META);
      ctx.markCompleted('n');
      expect(ctx.isCompleted('n')).toBe(true);
    });

    it('markSkipped tracks skip', () => {
      const ctx = new DGContext({}, META);
      ctx.markSkipped('n');
      expect(ctx.isSkipped('n')).toBe(true);
    });

    it('markFailed tracks failure', () => {
      const ctx = new DGContext({}, META);
      ctx.markFailed('n');
      expect(ctx.isFailed('n')).toBe(true);
    });
  });

  describe('buildResult', () => {
    it('builds DGResult from events', () => {
      const ctx = new DGContext({}, META);
      ctx.emit({
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'req-1',
        ts: new Date().toISOString(),
      });
      ctx.emit({
        type: 'graph.completed',
        status: 'completed',
        durationMs: 100,
        ts: new Date().toISOString(),
      });

      const compiled = makeCompiled();
      const result = ctx.buildResult(compiled);

      expect(result.status).toBe('completed');
      expect(result.durationMs).toBe(100);
      expect(result.graphId).toBe('g');
      expect(result.versions.dg).toBe('0.1.0');
    });

    it('defaults to failed status when no graph.completed event', () => {
      const ctx = new DGContext({}, META);
      const result = ctx.buildResult(makeCompiled());
      expect(result.status).toBe('failed');
    });
  });

  describe('persistence error handling', () => {
    it('calls onPersistenceError on adapter failure', async () => {
      const errors: unknown[] = [];
      const mockAdapter = {
        executions: {
          recordEvent: vi.fn().mockRejectedValue(new Error('persist fail')),
          startExecution: vi.fn(),
          completeExecution: vi.fn(),
          getExecution: vi.fn(),
          listExecutions: vi.fn(),
        },
      };

      const ctx = new DGContext({}, META, {
        adapter: mockAdapter as never,
        onPersistenceError: (err) => errors.push(err),
      });

      ctx.emit({
        type: 'graph.started',
        graphId: 'g',
        hash: 'h',
        requestId: 'r',
        ts: new Date().toISOString(),
      });

      // Wait for the async rejection to be caught
      await new Promise((r) => setTimeout(r, 50));
      expect(errors).toHaveLength(1);
    });
  });
});
