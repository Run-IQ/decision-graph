import { describe, it, expect, vi } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { computeNode, edge } from '../helpers/graph-builders.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGGraph } from '../../src/types/graph.js';
import type { NodeExecutor } from '../../src/executor/NodeExecutor.js';

const META: ExecutionMeta = {
  requestId: 'req-limits-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('limits integration', () => {
  it('respects maxDurationMs: times out long execution', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const slowExec: NodeExecutor = {
      execute: vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5000))),
    };
    const orch = new DGOrchestrator(slowExec, new Map(), {
      limits: { maxDurationMs: 50 },
    });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('failed');
  }, 10000);

  it('respects maxParallelNodes: limits concurrency', async () => {
    const nodes: Record<string, ReturnType<typeof computeNode>> = {};
    for (let i = 0; i < 10; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
    }
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes,
      edges: [],
    };
    const compiled = compiler.compile(graph);

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
      limits: { maxParallelNodes: 3 },
    });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBeLessThanOrEqual(3);
  });

  it('logLevel minimal: only graph and failure events', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi.fn().mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'minimal' });

    const result = await orch.execute(compiled, {}, META);

    // Minimal: only graph.started and graph.completed (and node.failed if any)
    const types = new Set(result.events.map((e) => e.type));
    expect(types.has('graph.started')).toBe(true);
    expect(types.has('graph.completed')).toBe(true);
    expect(types.has('node.started')).toBe(false);
    expect(types.has('level.started')).toBe(false);
  });

  it('logLevel verbose: all events present', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi.fn().mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    const types = new Set(result.events.map((e) => e.type));
    expect(types.has('graph.started')).toBe(true);
    expect(types.has('level.started')).toBe(true);
    expect(types.has('node.started')).toBe(true);
    expect(types.has('node.completed')).toBe(true);
    expect(types.has('level.completed')).toBe(true);
    expect(types.has('graph.completed')).toBe(true);
  });
});
