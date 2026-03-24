import { describe, it, expect } from 'vitest';
import { handleNodeError } from '../../../src/orchestrator/errorHandler.js';
import { DGContext } from '../../../src/context/DGContext.js';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import { DGHaltError } from '../../../src/errors.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function node(
  id: string,
  onError: 'fail' | 'skip' | 'fallback' = 'fail',
  propagation: 'halt' | 'skip-descendants' | 'continue' = 'halt',
  fallback?: Record<string, unknown>,
): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: [{ name: 'v', required: false }], out: [{ name: 'v', required: false }] },
    policy: {
      onError,
      onFailPropagation: propagation,
      ...(fallback !== undefined ? { fallback } : {}),
    },
  };
}

function edge(id: string, from: string, to: string) {
  return { id, from: { node: from, port: 'v' }, to: { node: to, port: 'v' } };
}

describe('errorHandler', () => {
  it('fallback: injects fallback values and marks completed', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', 'fallback', 'halt', { v: 0 }) },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isCompleted('a')).toBe(true);
    expect(ctx.get('a.v')).toBe(0);
    expect(ctx.getEvents().some((e) => e.type === 'node.fallback')).toBe(true);
  });

  it('skip: marks node as skipped', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', 'skip', 'continue') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isSkipped('a')).toBe(true);
    const skipEvent = ctx.getEvents().find((e) => e.type === 'node.skipped' && e.nodeId === 'a');
    expect(skipEvent).toBeDefined();
    expect((skipEvent as { reason: string }).reason).toBe('node-error-skip');
  });

  it('fail + halt: throws DGHaltError', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', 'fail', 'halt'), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    expect(() => handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx)).toThrow(
      DGHaltError,
    );
  });

  it('fail + skip-descendants: skips all descendants', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', 'fail', 'skip-descendants'),
        b: node('b'),
        c: node('c'),
      },
      edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isFailed('a')).toBe(true);
    expect(ctx.isSkipped('b')).toBe(true);
    expect(ctx.isSkipped('c')).toBe(true);
  });

  it('fail + continue: does nothing to descendants', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', 'fail', 'continue'),
        b: node('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isFailed('a')).toBe(true);
    expect(ctx.isSkipped('b')).toBe(false);
  });

  it('emits node.failed event', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', 'fail', 'continue') },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('test error'), compiled, ctx);
    const failed = ctx.getEvents().find((e) => e.type === 'node.failed');
    expect(failed).toBeDefined();
    if (failed && failed.type === 'node.failed') {
      expect(failed.error).toBe('test error');
    }
  });

  it('skip-descendants does not skip already-completed nodes', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', 'fail', 'skip-descendants'),
        b: node('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('b');

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isCompleted('b')).toBe(true);
    expect(ctx.isSkipped('b')).toBe(false);
  });

  it('skip + skip-descendants: skips self and descendants', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', 'skip', 'skip-descendants'),
        b: node('b'),
      },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    handleNodeError(graph.nodes['a']!, new Error('boom'), compiled, ctx);
    expect(ctx.isSkipped('a')).toBe(true);
    expect(ctx.isSkipped('b')).toBe(true);
  });
});
