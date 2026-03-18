import { describe, it, expect, vi } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { computeNode, mergeNode, edge } from '../helpers/graph-builders.js';
import { mockExecutor } from '../helpers/mock-executor.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGGraph } from '../../src/types/graph.js';
import type { NodeExecutor } from '../../src/executor/NodeExecutor.js';

const META: ExecutionMeta = {
  requestId: 'req-merge-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('merge strategies integration', () => {
  it('wait-all: merge completes when all parents complete', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        m: mergeNode('m', { strategy: 'wait-all' }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toContain('m');
  });

  it('wait-all with failed parent + proceed-with-available', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b', { onError: 'fail', onFailPropagation: 'continue' }),
        m: mergeNode('m', { strategy: 'wait-all', onPartialInputs: 'proceed-with-available' }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ outputs: { v: 10 }, durationMs: 1 }) // a
        .mockRejectedValueOnce(new Error('boom')) // b
        .mockResolvedValue({ outputs: { v: 99 }, durationMs: 1 }), // merge (won't be called since no model)
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    // b failed → not active for merge → wait-all met with just a
    expect(result.executed).toContain('a');
    expect(result.executed).toContain('m');
  });

  it('merge with model: executor is called', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        m: mergeNode('m', { strategy: 'wait-all', model: 'MERGE_M' }),
      },
      edges: [edge('e1', 'a', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec = mockExecutor({ v: 777 });
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('m');
    expect(exec.execute).toHaveBeenCalledTimes(2); // a + m
  });

  it('merge without model: pass-through', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        m: mergeNode('m'),
      },
      edges: [edge('e1', 'a', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    // Only a calls executor, m is pass-through
    expect(exec.execute).toHaveBeenCalledTimes(1);
    expect(result.executed).toContain('m');
  });

  it('diamond graph with wait-all merge', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        root: computeNode('root'),
        left: computeNode('left'),
        right: computeNode('right'),
        m: mergeNode('m', { strategy: 'wait-all' }),
      },
      edges: [
        edge('e1', 'root', 'left'),
        edge('e2', 'root', 'right'),
        edge('e3', 'left', 'm'),
        edge('e4', 'right', 'm'),
      ],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.status).toBe('completed');
    expect(result.executed).toEqual(expect.arrayContaining(['root', 'left', 'right', 'm']));
  });
});
