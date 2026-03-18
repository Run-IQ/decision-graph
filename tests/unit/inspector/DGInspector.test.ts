import { describe, it, expect } from 'vitest';
import { DGInspector } from '../../../src/inspector/DGInspector.js';
import type { DGGraph } from '../../../src/types/graph.js';
import type { DGResult } from '../../../src/types/result.js';
import type { DGEvent } from '../../../src/types/events.js';

function ts(): string {
  return new Date().toISOString();
}

function buildGraph(): DGGraph {
  return {
    id: 'g',
    version: '1',
    nodes: {
      a: {
        id: 'a',
        type: 'compute',
        model: 'M',
        ports: { in: [], out: [{ name: 'v', required: false }] },
        policy: { onError: 'fail', onFailPropagation: 'halt' },
      },
      b: {
        id: 'b',
        type: 'compute',
        model: 'M',
        ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
        policy: { onError: 'fail', onFailPropagation: 'halt' },
      },
      c: {
        id: 'c',
        type: 'compute',
        model: 'M',
        ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
        policy: { onError: 'fail', onFailPropagation: 'halt' },
      },
    },
    edges: [
      { id: 'e1', from: { node: 'a', port: 'v' }, to: { node: 'b', port: 'v' } },
      { id: 'e2', from: { node: 'b', port: 'v' }, to: { node: 'c', port: 'v' } },
    ],
  };
}

function buildEvents(): DGEvent[] {
  return [
    { type: 'graph.started', graphId: 'g', hash: 'h1', requestId: 'r1', ts: ts() },
    { type: 'level.started', level: 0, nodes: ['a'], mergeNodes: [], ts: ts() },
    { type: 'node.started', nodeId: 'a', nodeExecutionId: 'r1:a', inputs: { x: 1 }, ts: ts() },
    {
      type: 'node.completed',
      nodeId: 'a',
      nodeExecutionId: 'r1:a',
      outputs: { v: 10 },
      durationMs: 5,
      ts: ts(),
    },
    { type: 'level.completed', level: 0, durationMs: 5, ts: ts() },
    { type: 'level.started', level: 1, nodes: ['b'], mergeNodes: [], ts: ts() },
    { type: 'node.started', nodeId: 'b', nodeExecutionId: 'r1:b', inputs: { v: 10 }, ts: ts() },
    {
      type: 'node.completed',
      nodeId: 'b',
      nodeExecutionId: 'r1:b',
      outputs: { v: 20 },
      durationMs: 10,
      ts: ts(),
    },
    { type: 'level.completed', level: 1, durationMs: 10, ts: ts() },
    { type: 'level.started', level: 2, nodes: ['c'], mergeNodes: [], ts: ts() },
    { type: 'node.started', nodeId: 'c', nodeExecutionId: 'r1:c', inputs: { v: 20 }, ts: ts() },
    {
      type: 'node.completed',
      nodeId: 'c',
      nodeExecutionId: 'r1:c',
      outputs: { v: 30 },
      durationMs: 15,
      ts: ts(),
    },
    { type: 'level.completed', level: 2, durationMs: 15, ts: ts() },
    { type: 'graph.completed', status: 'completed', durationMs: 30, ts: ts() },
  ];
}

function buildResult(events: DGEvent[]): DGResult {
  return {
    graphId: 'g',
    graphHash: 'h1',
    requestId: 'r1',
    status: 'completed',
    outputs: { 'a.v': 10, 'b.v': 20, 'c.v': 30 },
    executed: ['a', 'b', 'c'],
    skipped: [],
    failed: [],
    events: Object.freeze(events),
    durationMs: 30,
    versions: { dg: '0.1.0', contextEngine: '0.2.0', core: '0.2.6' },
  };
}

describe('DGInspector', () => {
  it('explains a completed node', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const explanation = inspector.explainNode('a');

    expect(explanation.nodeId).toBe('a');
    expect(explanation.status).toBe('completed');
    expect(explanation.durationMs).toBe(5);
    expect(explanation.outputs).toEqual({ v: 10 });
  });

  it('explains a non-executed node', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const explanation = inspector.explainNode('nonexistent');

    expect(explanation.status).toBe('not-executed');
    expect(explanation.events).toHaveLength(0);
  });

  it('traces output contributors', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const trace = inspector.traceOutput('c.v');

    expect(trace).toContain('c');
    // BFS should also find upstream contributors
    expect(trace.length).toBeGreaterThanOrEqual(1);
  });

  it('computes critical path', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const cp = inspector.criticalPath();

    expect(cp.path).toEqual(['a', 'b', 'c']);
    expect(cp.totalDurationMs).toBe(30); // 5 + 10 + 15
  });

  it('replays events up to index', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const snap = inspector.replayUntil(4);

    expect(snap.completedNodes).toContain('a');
    expect(snap.completedNodes).not.toContain('b');
    expect(snap.status).toBe('in-progress');
  });

  it('replays events with predicate', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const snap = inspector.replayUntil((e) => e.type === 'level.started' && e.level === 2);

    expect(snap.completedNodes).toContain('a');
    expect(snap.completedNodes).toContain('b');
    expect(snap.completedNodes).not.toContain('c');
  });

  it('generates Mermaid output', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const mermaid = inspector.toMermaid();

    expect(mermaid).toContain('graph TD');
    expect(mermaid).toContain('a');
    expect(mermaid).toContain('fill:#6f6');
  });

  it('generates Graphviz output', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const dot = inspector.toGraphviz();

    expect(dot).toContain('digraph');
    expect(dot).toContain('a ->');
    expect(dot).toContain('fillcolor="#66ff66"');
  });

  it('generates visualization data', () => {
    const events = buildEvents();
    const inspector = new DGInspector(buildGraph(), buildResult(events));
    const data = inspector.toVisualizationData();

    expect(data.graphId).toBe('g');
    expect(data.nodes).toHaveLength(3);
    expect(data.edges).toHaveLength(2);
    expect(data.status).toBe('completed');
    expect(data.nodes.find((n) => n.id === 'a')?.status).toBe('completed');
  });

  it('handles failed nodes in explanation', () => {
    const events: DGEvent[] = [
      { type: 'node.started', nodeId: 'a', nodeExecutionId: 'r1:a', inputs: {}, ts: ts() },
      {
        type: 'node.failed',
        nodeId: 'a',
        nodeExecutionId: 'r1:a',
        error: 'boom',
        propagation: 'halt',
        ts: ts(),
      },
    ];
    const result: DGResult = {
      ...buildResult(events),
      status: 'failed',
      executed: [],
      failed: ['a'],
      events: Object.freeze(events),
    };
    const inspector = new DGInspector(buildGraph(), result);
    const explanation = inspector.explainNode('a');

    expect(explanation.status).toBe('failed');
    expect(explanation.error).toBe('boom');
  });

  it('handles skipped nodes in explanation', () => {
    const events: DGEvent[] = [
      { type: 'node.skipped', nodeId: 'b', reason: 'edge-condition-false', ts: ts() },
    ];
    const result: DGResult = {
      ...buildResult(events),
      status: 'partial',
      executed: [],
      skipped: ['b'],
      events: Object.freeze(events),
    };
    const inspector = new DGInspector(buildGraph(), result);
    const explanation = inspector.explainNode('b');

    expect(explanation.status).toBe('skipped');
    expect(explanation.skipReason).toBe('edge-condition-false');
  });

  it('handles fallback in explanation', () => {
    const events: DGEvent[] = [
      { type: 'node.fallback', nodeId: 'a', fallback: { v: 0 }, ts: ts() },
    ];
    const result: DGResult = {
      ...buildResult(events),
      executed: ['a'],
      events: Object.freeze(events),
    };
    const inspector = new DGInspector(buildGraph(), result);
    const explanation = inspector.explainNode('a');

    expect(explanation.status).toBe('completed');
    expect(explanation.fallback).toEqual({ v: 0 });
  });
});
