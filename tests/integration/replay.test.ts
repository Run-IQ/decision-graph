import { describe, it, expect } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { DGInspector } from '../../src/inspector/DGInspector.js';
import { linearGraph, diamondGraph } from '../helpers/graph-builders.js';
import { mockExecutor } from '../helpers/mock-executor.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-replay-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('replay integration', () => {
  it('replays full execution matches result state', async () => {
    const graph = linearGraph(['a', 'b', 'c']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const snap = inspector.replayUntil(result.events.length);

    expect(snap.completedNodes).toEqual(expect.arrayContaining(['a', 'b', 'c']));
    expect(snap.status).toBe('completed');
  });

  it('replay partial: stops mid-execution', async () => {
    const graph = linearGraph(['a', 'b', 'c']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    // Stop at first level.completed
    const snap = inspector.replayUntil((e) => e.type === 'level.completed');

    expect(snap.completedNodes).toContain('a');
    expect(snap.status).toBe('in-progress');
  });

  it('replay diamond graph', async () => {
    const graph = diamondGraph();
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const snap = inspector.replayUntil(result.events.length);
    expect(snap.completedNodes).toEqual(expect.arrayContaining(['root', 'left', 'right', 'merge']));
  });

  it('Mermaid export includes node styles from result', async () => {
    const graph = linearGraph(['a', 'b']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const mermaid = inspector.toMermaid();
    expect(mermaid).toContain('fill:#6f6');
    expect(mermaid).toContain('graph TD');
  });

  it('Graphviz export is valid DOT', async () => {
    const graph = linearGraph(['a', 'b']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const dot = inspector.toGraphviz();
    expect(dot).toMatch(/^digraph/);
    expect(dot).toContain('a ->');
    expect(dot).toContain('}');
  });

  it('visualization data matches result', async () => {
    const graph = linearGraph(['a', 'b']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const viz = inspector.toVisualizationData();
    expect(viz.graphId).toBe(graph.id);
    expect(viz.nodes).toHaveLength(2);
    expect(viz.edges).toHaveLength(1);
    expect(viz.status).toBe('completed');
    expect(viz.nodes.every((n) => n.status === 'completed')).toBe(true);
  });
});
