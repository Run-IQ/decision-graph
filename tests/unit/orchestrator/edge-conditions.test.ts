import { describe, it, expect, vi } from 'vitest';
import { resolveActiveNodes } from '../../../src/orchestrator/edgeResolver.js';
import { DGContext } from '../../../src/context/DGContext.js';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import type { DGGraph, DGNode, DGEdge } from '../../../src/types/graph.js';
import type { DSLEvaluator } from '@run-iq/core';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function node(id: string, inPorts: string[] = ['v'], outPorts: string[] = ['v']): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: {
      in: inPorts.map((n) => ({ name: n, required: false })),
      out: outPorts.map((n) => ({ name: n, required: false })),
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function edge(id: string, from: string, to: string, condition?: DGEdge['condition']): DGEdge {
  return {
    id,
    from: { node: from, port: 'v' },
    to: { node: to, port: 'v' },
    ...(condition !== undefined ? { condition } : {}),
  };
}

function trueDSL(): DSLEvaluator {
  return { dsl: 'jsonlogic', version: '1.0.0', evaluate: () => true };
}

function falseDSL(): DSLEvaluator {
  return { dsl: 'jsonlogic', version: '1.0.0', evaluate: () => false };
}

describe('edgeResolver', () => {
  it('root nodes are always active', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']) },
      edges: [],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });

    const { active, skipped } = resolveActiveNodes(['a'], compiled, ctx, new Map());
    expect(active).toEqual(['a']);
    expect(skipped).toEqual([]);
  });

  it('unconditional edge activates node', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');

    const { active } = resolveActiveNodes(['b'], compiled, ctx, new Map());
    expect(active).toEqual(['b']);
  });

  it('true condition activates node', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [edge('e1', 'a', 'b', { dsl: 'jsonlogic', expression: true, scope: 'source-output' })],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 42);

    const dsls = new Map([['jsonlogic', trueDSL()]]);
    const { active } = resolveActiveNodes(['b'], compiled, ctx, dsls);
    expect(active).toEqual(['b']);
  });

  it('false condition skips node', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'jsonlogic', expression: false, scope: 'source-output' }),
      ],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 42);

    const dsls = new Map([['jsonlogic', falseDSL()]]);
    const { active, skipped } = resolveActiveNodes(['b'], compiled, ctx, dsls);
    expect(active).toEqual([]);
    expect(skipped).toEqual(['b']);
  });

  it('source-output scope passes node outputs to DSL', () => {
    const evalSpy = vi.fn().mockReturnValue(true);
    const dsl: DSLEvaluator = { dsl: 'jsonlogic', version: '1.0.0', evaluate: evalSpy };

    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [
        edge('e1', 'a', 'b', {
          dsl: 'jsonlogic',
          expression: { '>': [{ var: 'v' }, 0] },
          scope: 'source-output',
        }),
      ],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 42);

    resolveActiveNodes(['b'], compiled, ctx, new Map([['jsonlogic', dsl]]));
    expect(evalSpy).toHaveBeenCalledWith({ '>': [{ var: 'v' }, 0] }, { v: 42 });
  });

  it('full-context scope passes full state to DSL', () => {
    const evalSpy = vi.fn().mockReturnValue(true);
    const dsl: DSLEvaluator = { dsl: 'jsonlogic', version: '1.0.0', evaluate: evalSpy };

    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [edge('e1', 'a', 'b', { dsl: 'jsonlogic', expression: true, scope: 'full-context' })],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({ x: 1 }, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.set('a', 'v', 42);

    resolveActiveNodes(['b'], compiled, ctx, new Map([['jsonlogic', dsl]]));
    const passedContext = evalSpy.mock.calls[0]![1] as Record<string, unknown>;
    expect(passedContext['input.x']).toBe(1);
    expect(passedContext['a.v']).toBe(42);
  });

  it('skipped parent makes edge inactive', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markSkipped('a');

    const { active, skipped } = resolveActiveNodes(['b'], compiled, ctx, new Map());
    expect(active).toEqual([]);
    expect(skipped).toEqual(['b']);
  });

  it('missing DSL makes edge inactive', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: node('a', [], ['v']), b: node('b') },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'unknown-dsl', expression: true, scope: 'source-output' }),
      ],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');

    const { skipped } = resolveActiveNodes(['b'], compiled, ctx, new Map());
    expect(skipped).toEqual(['b']);
  });

  it('multiple edges — one active is enough', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: node('a', [], ['v']),
        b: node('b', [], ['v']),
        c: node('c'),
      },
      edges: [
        edge('e1', 'a', 'c', { dsl: 'jsonlogic', expression: false, scope: 'source-output' }),
        edge('e2', 'b', 'c'),
      ],
    };
    const compiled = new DGCompiler().compile(graph);
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.markCompleted('a');
    ctx.markCompleted('b');
    ctx.set('a', 'v', 1);
    ctx.set('b', 'v', 2);

    const dsls = new Map([['jsonlogic', falseDSL()]]);
    const { active } = resolveActiveNodes(['c'], compiled, ctx, dsls);
    expect(active).toEqual(['c']);
  });
});
