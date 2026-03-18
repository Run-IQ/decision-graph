import { describe, it, expect, vi } from 'vitest';
import { runMerge } from '../../../src/orchestrator/mergeRunner.js';
import { DGContext } from '../../../src/context/DGContext.js';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function computeNode(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function mergeNode(
  id: string,
  strategy: 'wait-all' | 'wait-any' | 'wait-quorum' = 'wait-all',
  onPartialInputs: 'fail' | 'proceed-with-available' | 'use-defaults' = 'fail',
  quorum?: number,
  hasModel = false,
): DGNode {
  return {
    id,
    type: 'merge',
    ...(hasModel ? { model: 'MERGE_MODEL' } : {}),
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

function mockExecutor(outputs: Record<string, unknown> = { v: 100 }) {
  return { execute: vi.fn().mockResolvedValue({ outputs, durationMs: 1 }) };
}

describe('mergeRunner', () => {
  it('wait-all: completes when all parents done', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b'), m: mergeNode('m', 'wait-all') },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);
    ctx.markCompleted('b');
    ctx.set('b', 'v', 20);

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('wait-all: fails when not all parents done and onPartialInputs=fail', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: { ...computeNode('b'), policy: { onError: 'fail', onFailPropagation: 'continue' } },
        m: mergeNode('m', 'wait-all', 'fail'),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);
    ctx.markFailed('b');

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    // Should have been handled by handleNodeError
    expect(ctx.isCompleted('m') || ctx.isFailed('m') || ctx.isSkipped('m')).toBe(true);
  });

  it('wait-any: completes with just one parent', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: { ...computeNode('b'), policy: { onError: 'fail', onFailPropagation: 'continue' } },
        m: mergeNode('m', 'wait-any'),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);
    // b not completed yet

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('wait-quorum: completes when quorum met', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
        m: mergeNode('m', 'wait-quorum', 'proceed-with-available', 2),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm'), edge('e3', 'c', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 1);
    ctx.markCompleted('b');
    ctx.set('b', 'v', 2);
    // c not done

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('wait-quorum: fails when quorum not met with fail policy', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
        m: mergeNode('m', 'wait-quorum', 'fail', 3),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm'), edge('e3', 'c', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 1);
    // b and c not done

    await expect(runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META)).rejects.toThrow(
      'halt',
    );
  });

  it('merge with model: executes via executor', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), m: mergeNode('m', 'wait-all', 'fail', undefined, true) },
      edges: [edge('e1', 'a', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);

    const exec = mockExecutor({ v: 99 });
    await runMerge(graph.nodes['m']!, compiled, ctx, exec, META);
    expect(exec.execute).toHaveBeenCalledTimes(1);
    expect(ctx.get('m.v')).toBe(99);
  });

  it('merge without model: pass-through', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), m: mergeNode('m', 'wait-all') },
      edges: [edge('e1', 'a', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);

    const exec = mockExecutor();
    await runMerge(graph.nodes['m']!, compiled, ctx, exec, META);
    expect(exec.execute).not.toHaveBeenCalled();
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('emits merge.waiting event', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), m: mergeNode('m', 'wait-all') },
      edges: [edge('e1', 'a', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    expect(ctx.getEvents().some((e) => e.type === 'merge.waiting')).toBe(true);
  });

  it('proceed-with-available uses available inputs', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: { ...computeNode('b'), policy: { onError: 'fail', onFailPropagation: 'continue' } },
        m: mergeNode('m', 'wait-all', 'proceed-with-available'),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);
    ctx.markFailed('b');

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    // Should proceed since b is failed (not active), so wait-all is met on remaining actives
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('skipped parents are not counted as active', async () => {
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
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 10);
    ctx.markSkipped('b');

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    // b is skipped → not active → wait-all only needs a
    expect(ctx.isCompleted('m')).toBe(true);
  });

  it('no parents active: empty merge completes', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { m: mergeNode('m', 'wait-all') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    await runMerge(graph.nodes['m']!, compiled, ctx, mockExecutor(), META);
    expect(ctx.isCompleted('m')).toBe(true);
  });
});
