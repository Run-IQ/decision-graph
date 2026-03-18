import { describe, it, expect, vi } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { computeNode, mergeNode, edge } from '../helpers/graph-builders.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGGraph } from '../../src/types/graph.js';
import type { NodeExecutor } from '../../src/executor/NodeExecutor.js';

const META: ExecutionMeta = {
  requestId: 'req-policy-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

function failFirst(): NodeExecutor {
  return {
    execute: vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
  };
}

function succeedAll(): NodeExecutor {
  return {
    execute: vi.fn().mockResolvedValue({ outputs: { v: 42 }, durationMs: 1 }),
  };
}

describe('policy matrix integration', () => {
  // onError=fail + propagation=halt → graph fails immediately
  it('fail + halt → graph failed', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a', { onError: 'fail', onFailPropagation: 'halt' }) },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(failFirst(), new Map());

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('failed');
  });

  // onError=fail + propagation=skip-descendants → partial
  it('fail + skip-descendants → partial', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fail', onFailPropagation: 'skip-descendants' }),
        b: computeNode('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(failFirst(), new Map());

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('partial');
    expect(result.failed).toContain('a');
    expect(result.skipped).toContain('b');
  });

  // onError=fail + propagation=continue → partial (node failed exists)
  it('fail + continue → partial', async () => {
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
    const orch = new DGOrchestrator(failFirst(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('partial');
    expect(result.failed).toContain('a');
  });

  // onError=skip + propagation=continue → completed (skip is not a failure event)
  it('skip + continue → completed status', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'skip', onFailPropagation: 'continue' }),
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(failFirst(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    expect(result.skipped).toContain('a');
    // No node.failed events → status is completed
    expect(result.status).toBe('completed');
  });

  // onError=fallback → completed (fallback = completed)
  it('fallback → completed', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fallback', onFailPropagation: 'halt', fallback: { v: 0 } }),
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(failFirst(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('completed');
    expect(result.executed).toContain('a');
  });

  // All nodes succeed → completed
  it('all success → completed', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(succeedAll(), new Map());

    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('completed');
    expect(result.executed).toHaveLength(3);
  });

  // Complex: diamond with one branch failing + skip-descendants
  it('diamond: one branch fails with skip-descendants → merge skipped → partial', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        root: computeNode('root'),
        left: computeNode('left', { onError: 'fail', onFailPropagation: 'skip-descendants' }),
        right: computeNode('right'),
        m: mergeNode('m', { strategy: 'wait-all', onPartialInputs: 'proceed-with-available' }),
      },
      edges: [
        edge('e1', 'root', 'left'),
        edge('e2', 'root', 'right'),
        edge('e3', 'left', 'm'),
        edge('e4', 'right', 'm'),
      ],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ outputs: { v: 1 }, durationMs: 1 }) // root
        .mockRejectedValueOnce(new Error('left-fail')) // left
        .mockResolvedValueOnce({ outputs: { v: 3 }, durationMs: 1 }) // right
        .mockResolvedValue({ outputs: { v: 99 }, durationMs: 1 }), // merge
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.failed).toContain('left');
    expect(result.executed).toContain('root');
    expect(result.executed).toContain('right');
    // m is a descendant of left, so skip-descendants skips m
    expect(result.skipped).toContain('m');
    expect(result.status).toBe('partial');
  });
});
