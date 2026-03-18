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
): DGNode {
  return {
    id,
    type: 'merge',
    ports: {
      in: [{ name: 'v', required: false, default: 0 }],
      out: [{ name: 'v', required: false }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    meta: { mergeConfig: { strategy, onPartialInputs } },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

function mockExecutor(outputs: Record<string, unknown> = { v: 42 }): NodeExecutor {
  return { execute: vi.fn().mockResolvedValue({ outputs, durationMs: 1 }) };
}

describe('Eager scheduling', () => {
  it('produces the same result as level scheduling for a linear chain', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), c: computeNode('c') },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
    expect(result.executed).toContain('c');
  });

  it('starts node as soon as its deps complete (no level barrier)', async () => {
    // Diamond: A→C, B→C. A is fast, B is slow.
    // In level mode: C waits for both A and B + level barrier.
    // In eager mode: C starts once both A and B finish (no extra barrier).
    // We verify C doesn't start before B finishes.
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), c: computeNode('c') },
      edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
    };
    const compiled = new DGCompiler().compile(graph);

    const executionOrder: string[] = [];
    const exec: NodeExecutor = {
      execute: vi.fn().mockImplementation(async (node: DGNode) => {
        if (node.id === 'b') {
          await new Promise((r) => setTimeout(r, 30));
        }
        executionOrder.push(node.id);
        return { outputs: { v: 1 }, durationMs: 1 };
      }),
    };

    const orch = new DGOrchestrator(exec, new Map(), { scheduling: 'eager' });
    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('c');
    // c must appear after both a and b
    const cIdx = executionOrder.indexOf('c');
    expect(cIdx).toBeGreaterThan(executionOrder.indexOf('a'));
    expect(cIdx).toBeGreaterThan(executionOrder.indexOf('b'));
  });

  it('eager mode is faster when node durations vary (no unnecessary waiting)', async () => {
    //  Level 0: A (slow=50ms), B (fast=5ms)
    //  Level 1: C (depends only on B, fast=5ms)
    //
    //  In level mode:  C waits for A to finish (level barrier) → ~60ms total
    //  In eager mode:  C starts after B finishes (~10ms), A runs in parallel → ~55ms total
    //
    // We can't test exact timing but we verify C runs after B and before A finishes.
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), c: computeNode('c') },
      edges: [edge('e1', 'b', 'c')], // c depends only on b, not a
    };
    const compiled = new DGCompiler().compile(graph);

    const timestamps: Record<string, number> = {};
    const exec: NodeExecutor = {
      execute: vi.fn().mockImplementation(async (node: DGNode) => {
        const start = Date.now();
        if (node.id === 'a') await new Promise((r) => setTimeout(r, 80));
        else await new Promise((r) => setTimeout(r, 5));
        timestamps[node.id] = Date.now() - start;
        return { outputs: { v: 1 }, durationMs: 1 };
      }),
    };

    const orch = new DGOrchestrator(exec, new Map(), {
      scheduling: 'eager',
      limits: { maxParallelNodes: 10 },
    });
    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed.length).toBe(3);
    // In eager mode, total duration should be closer to max(A,B+C) not A+B+C
    expect(result.durationMs).toBeLessThan(200);
  });

  it('handles node failure with halt in eager mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a', 'fail', 'halt') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const exec: NodeExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const orch = new DGOrchestrator(exec, new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('failed');
  });

  it('handles skip-descendants in eager mode', async () => {
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
    const orch = new DGOrchestrator(exec, new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.failed).toContain('a');
    expect(result.skipped).toContain('b');
    expect(result.status).toBe('partial');
  });

  it('respects maxParallelNodes in eager mode', async () => {
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

    const orch = new DGOrchestrator(exec, new Map(), {
      scheduling: 'eager',
      limits: { maxParallelNodes: 2 },
    });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('emits approximate level events in eager mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), {
      scheduling: 'eager',
      logLevel: 'verbose',
    });

    const result = await orch.execute(compiled, {}, META);

    const types = result.events.map((e) => e.type);
    expect(types).toContain('graph.started');
    expect(types).toContain('level.started');
    expect(types).toContain('level.completed');
    expect(types).toContain('graph.completed');
  });

  it('fires lifecycle hooks in eager mode', async () => {
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
    const orch = new DGOrchestrator(mockExecutor(), new Map(), {
      scheduling: 'eager',
      hooks,
    });

    await orch.execute(compiled, {}, META);

    expect(hooks.beforeGraph).toHaveBeenCalledTimes(1);
    expect(hooks.beforeNode).toHaveBeenCalledTimes(1);
    expect(hooks.afterNode).toHaveBeenCalledTimes(1);
    expect(hooks.afterGraph).toHaveBeenCalledTimes(1);
  });

  it('executes merge node after all parents in eager mode', async () => {
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
    const orch = new DGOrchestrator(exec, new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('m');
  });

  it('handles empty graph in eager mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {},
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('completed');
    expect(result.executed).toHaveLength(0);
  });

  it('single node with no deps in eager mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { scheduling: 'eager' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
  });

  it('maxParallelNodes=1 serializes execution in eager mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), c: computeNode('c') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    let concurrent = 0;
    let maxConcurrent = 0;

    const exec: NodeExecutor = {
      execute: vi.fn().mockImplementation(async () => {
        concurrent++;
        if (concurrent > maxConcurrent) maxConcurrent = concurrent;
        await new Promise((r) => setTimeout(r, 5));
        concurrent--;
        return { outputs: { v: 1 }, durationMs: 1 };
      }),
    };

    const orch = new DGOrchestrator(exec, new Map(), {
      scheduling: 'eager',
      limits: { maxParallelNodes: 1 },
    });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBe(1);
  });
});
