import { describe, it, expect, vi } from 'vitest';
import { DGOrchestrator } from '../../../src/orchestrator/DGOrchestrator.js';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { NodeExecutor } from '../../../src/executor/NodeExecutor.js';
import type { DGLifecycleHooks } from '../../../src/orchestrator/hooks.js';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function computeNode(
  id: string,
  onError: 'fail' | 'skip' | 'fallback' = 'fail',
  propagation: 'halt' | 'skip-descendants' | 'continue' = 'halt',
): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError, onFailPropagation: propagation },
  };
}

function mergeNode(
  id: string,
  strategy: 'wait-all' | 'wait-any' | 'wait-quorum' = 'wait-all',
  onPartialInputs: 'fail' | 'proceed-with-available' | 'use-defaults' = 'fail',
  quorum?: number,
): DGNode {
  return {
    id,
    type: 'merge',
    ports: {
      in: [{ name: 'v', required: false, default: 0 }],
      out: [{ name: 'v', required: false }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    meta: {
      mergeConfig: {
        strategy,
        ...(quorum !== undefined ? { quorum } : {}),
        onPartialInputs,
      },
    },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

function mockExecutor(outputs: Record<string, unknown> = { v: 42 }): NodeExecutor {
  return { execute: vi.fn().mockResolvedValue({ outputs, durationMs: 1 }) };
}

function failingExecutor(msg = 'boom'): NodeExecutor {
  return { execute: vi.fn().mockRejectedValue(new Error(msg)) };
}

describe('DGOrchestrator', () => {
  it('executes a single-node graph', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.failed).toHaveLength(0);
  });

  it('executes a linear chain A → B → C', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), c: computeNode('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
    expect(result.executed).toContain('c');
    expect(exec.execute).toHaveBeenCalledTimes(3);
  });

  it('executes parallel nodes in the same level', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
    expect(exec.execute).toHaveBeenCalledTimes(2);
  });

  it('handles node failure with halt propagation', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a', 'fail', 'halt') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(failingExecutor(), new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('failed');
  });

  it('handles node failure with skip propagation', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', 'fail', 'skip-descendants'),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.failed).toContain('a');
    expect(result.skipped).toContain('b');
    expect(result.status).toBe('partial');
  });

  it('handles node failure with skip onError', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', 'skip', 'continue'),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.skipped).toContain('a');
    // b is also skipped because its only parent (a) is skipped,
    // so the edge resolver marks the edge inactive → b has no active edges → skipped
    expect(result.skipped).toContain('b');
  });

  it('emits graph lifecycle events', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    const types = result.events.map((e) => e.type);
    expect(types).toContain('graph.started');
    expect(types).toContain('level.started');
    expect(types).toContain('node.started');
    expect(types).toContain('node.completed');
    expect(types).toContain('level.completed');
    expect(types).toContain('graph.completed');
  });

  it('fires lifecycle hooks', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const hooks: DGLifecycleHooks = {
      beforeGraph: vi.fn(),
      beforeNode: vi.fn(),
      afterNode: vi.fn(),
      afterGraph: vi.fn(),
    };
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { hooks });

    await orch.execute(compiled, {}, META);

    expect(hooks.beforeGraph).toHaveBeenCalledTimes(1);
    expect(hooks.beforeNode).toHaveBeenCalledTimes(1);
    expect(hooks.afterNode).toHaveBeenCalledTimes(1);
    expect(hooks.afterGraph).toHaveBeenCalledTimes(1);
  });

  it('executes merge nodes after parallel nodes', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        m: mergeNode('m', 'wait-all'),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
    expect(result.executed).toContain('m');
  });

  it('respects maxParallelNodes limit', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
        d: computeNode('d'),
      },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    let concurrent = 0;
    let maxConcurrent = 0;

    const exec: NodeExecutor = {
      execute: vi.fn().mockImplementation(async () => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        await new Promise((r) => setTimeout(r, 10));
        concurrent--;
        return { outputs: { v: 1 }, durationMs: 1 };
      }),
    };

    const orch = new DGOrchestrator(exec, new Map(), { limits: { maxParallelNodes: 2 } });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('streams events via EventEmitter', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const { EventEmitter } = await import('node:events');
    const emitter = new EventEmitter();
    const events: unknown[] = [];
    emitter.on('dg:event', (e: unknown) => events.push(e));

    const orch = new DGOrchestrator(mockExecutor(), new Map(), {
      streaming: emitter,
      logLevel: 'verbose',
    });

    await orch.execute(compiled, {}, META);

    expect(events.length).toBeGreaterThan(0);
  });

  it('returns correct result structure', async () => {
    const graph: DGGraph = {
      id: 'test-graph',
      version: '2',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());

    const result = await orch.execute(compiled, {}, META);

    expect(result.graphId).toBe('test-graph');
    expect(result.graphHash).toBe(compiled.hash);
    expect(result.requestId).toBe('req-1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.versions.dg).toBeDefined();
    expect(result.events.length).toBeGreaterThan(0);
  });
});
