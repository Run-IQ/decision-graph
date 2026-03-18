import { describe, it, expect } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { DGInspector } from '../../src/inspector/DGInspector.js';
import { linearGraph, diamondGraph, computeNode } from '../helpers/graph-builders.js';
import { mockExecutor, dynamicExecutor, transformExecutor } from '../helpers/mock-executor.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGGraph } from '../../src/types/graph.js';

const META: ExecutionMeta = {
  requestId: 'req-integ-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('single-domain integration', () => {
  it('executes a single-node graph end-to-end', async () => {
    const graph: DGGraph = { id: 'g', version: '1', nodes: { a: computeNode('a') }, edges: [] };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor({ v: 100 }), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toEqual(['a']);
    expect(result.graphId).toBe('g');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('executes a linear chain and propagates data', async () => {
    const graph = linearGraph(['a', 'b', 'c']);
    const compiled = compiler.compile(graph);
    const exec = transformExecutor((inputs) => {
      const v = (inputs['v'] as number | undefined) ?? 0;
      return { v: v + 10 };
    });
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
    expect(result.executed).toContain('c');
  });

  it('executes a diamond graph with merge', async () => {
    const graph = diamondGraph();
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('root');
    expect(result.executed).toContain('left');
    expect(result.executed).toContain('right');
    expect(result.executed).toContain('merge');
  });

  it('result events contain graph lifecycle events', async () => {
    const graph = linearGraph(['a', 'b']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    const types = result.events.map((e) => e.type);
    expect(types[0]).toBe('graph.started');
    expect(types[types.length - 1]).toBe('graph.completed');
    expect(types).toContain('level.started');
    expect(types).toContain('level.completed');
  });

  it('inspector works on completed result', async () => {
    const graph = linearGraph(['a', 'b']);
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);

    const explanation = inspector.explainNode('a');
    expect(explanation.status).toBe('completed');
    expect(explanation.durationMs).toBeDefined();

    const mermaid = inspector.toMermaid();
    expect(mermaid).toContain('graph TD');
  });

  it('executes parallel nodes at same level', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const exec = dynamicExecutor((node) => ({
      outputs: { v: node.id.charCodeAt(0) },
      durationMs: 1,
    }));
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toHaveLength(3);
  });

  it('computes critical path on linear graph', async () => {
    const graph = linearGraph(['a', 'b', 'c']);
    const compiled = compiler.compile(graph);
    const exec = dynamicExecutor(() => ({ outputs: { v: 1 }, durationMs: 10 }));
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    const inspector = new DGInspector(graph, result);
    const cp = inspector.criticalPath();

    expect(cp.path).toEqual(['a', 'b', 'c']);
    expect(cp.totalDurationMs).toBe(30);
  });

  it('result includes correct version info', async () => {
    const graph: DGGraph = { id: 'g', version: '1', nodes: { a: computeNode('a') }, edges: [] };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.versions.dg).toBe('0.1.0');
    expect(result.graphHash).toBe(compiled.hash);
  });
});
