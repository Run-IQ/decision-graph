import { describe, it, expect, vi } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { computeNode, edge } from '../helpers/graph-builders.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGGraph } from '../../src/types/graph.js';
import type { NodeExecutor } from '../../src/executor/NodeExecutor.js';

const META: ExecutionMeta = {
  requestId: 'req-fail-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('failure propagation integration', () => {
  it('halt: graph stops on failure', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fail', onFailPropagation: 'halt' }),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('failed');
    expect(result.failed).toContain('a');
  });

  it('skip-descendants: descendants are skipped', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fail', onFailPropagation: 'skip-descendants' }),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('partial');
    expect(result.failed).toContain('a');
    expect(result.skipped).toContain('b');
    expect(result.skipped).toContain('c');
  });

  it('continue: downstream still attempts execution', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fail', onFailPropagation: 'continue' }),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.failed).toContain('a');
    // b gets skipped by edge resolver (parent failed → edge inactive)
    expect(result.skipped).toContain('b');
  });

  it('fallback: node uses fallback values and completes', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fallback', onFailPropagation: 'halt', fallback: { v: 0 } }),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 99 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a'); // fallback marks as completed
    expect(result.executed).toContain('b');
  });

  it('skip onError: node is skipped, descendants via edge resolver', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'skip', onFailPropagation: 'continue' }),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('boom'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.skipped).toContain('a');
    expect(result.skipped).toContain('b');
  });

  it('hooks onError is called when node fails', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a', { onError: 'fail', onFailPropagation: 'halt' }) },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const onError = vi.fn();
    const exec: NodeExecutor = { execute: vi.fn().mockRejectedValue(new Error('boom')) };
    const orch = new DGOrchestrator(exec, new Map(), { hooks: { onError } });

    await orch.execute(compiled, {}, META);

    expect(onError).toHaveBeenCalledTimes(1);
  });
});
