import { describe, it, expect } from 'vitest';
import { replayUntil } from '../../../src/inspector/replay.js';
import type { DGEvent } from '../../../src/types/events.js';

function ts(): string {
  return new Date().toISOString();
}

const sampleEvents: DGEvent[] = [
  { type: 'graph.started', graphId: 'g', hash: 'h', requestId: 'r', ts: ts() },
  { type: 'level.started', level: 0, nodes: ['a', 'b'], mergeNodes: [], ts: ts() },
  { type: 'node.started', nodeId: 'a', nodeExecutionId: 'r:a', inputs: {}, ts: ts() },
  {
    type: 'node.completed',
    nodeId: 'a',
    nodeExecutionId: 'r:a',
    outputs: { v: 1 },
    durationMs: 5,
    ts: ts(),
  },
  { type: 'node.started', nodeId: 'b', nodeExecutionId: 'r:b', inputs: {}, ts: ts() },
  {
    type: 'node.failed',
    nodeId: 'b',
    nodeExecutionId: 'r:b',
    error: 'boom',
    propagation: 'skip-descendants',
    ts: ts(),
  },
  { type: 'node.skipped', nodeId: 'c', reason: 'parent-failed-propagation', ts: ts() },
  { type: 'edge.inactive', edgeId: 'e1', scope: 'parent-unavailable', evaluated: null, ts: ts() },
  { type: 'level.completed', level: 0, durationMs: 10, ts: ts() },
  { type: 'graph.completed', status: 'partial', durationMs: 15, ts: ts() },
];

describe('replay', () => {
  it('replays all events when until = events.length', () => {
    const snap = replayUntil(sampleEvents, sampleEvents.length);
    expect(snap.completedNodes).toContain('a');
    expect(snap.failedNodes).toContain('b');
    expect(snap.skippedNodes).toContain('c');
    expect(snap.inactiveEdges).toContain('e1');
    expect(snap.status).toBe('partial');
  });

  it('replays up to index (exclusive)', () => {
    const snap = replayUntil(sampleEvents, 4);
    expect(snap.completedNodes).toContain('a');
    expect(snap.failedNodes).toHaveLength(0);
    expect(snap.status).toBe('in-progress');
    expect(snap.events).toHaveLength(4);
  });

  it('replays with predicate stopping at first failure', () => {
    const snap = replayUntil(sampleEvents, (e) => e.type === 'node.failed');
    expect(snap.completedNodes).toContain('a');
    expect(snap.failedNodes).toHaveLength(0); // stops before the failed event
    expect(snap.events.length).toBeLessThan(sampleEvents.length);
  });

  it('returns empty snapshot for 0 index', () => {
    const snap = replayUntil(sampleEvents, 0);
    expect(snap.completedNodes).toHaveLength(0);
    expect(snap.failedNodes).toHaveLength(0);
    expect(snap.skippedNodes).toHaveLength(0);
    expect(snap.events).toHaveLength(0);
    expect(snap.status).toBe('in-progress');
  });

  it('handles empty event list', () => {
    const snap = replayUntil([], 10);
    expect(snap.completedNodes).toHaveLength(0);
    expect(snap.status).toBe('in-progress');
  });

  it('tracks fallback as completed', () => {
    const events: DGEvent[] = [
      { type: 'node.fallback', nodeId: 'x', fallback: { v: 0 }, ts: ts() },
    ];
    const snap = replayUntil(events, events.length);
    expect(snap.completedNodes).toContain('x');
  });

  it('captures final status from graph.completed', () => {
    const events: DGEvent[] = [
      { type: 'graph.completed', status: 'completed', durationMs: 5, ts: ts() },
    ];
    const snap = replayUntil(events, events.length);
    expect(snap.status).toBe('completed');
  });
});
