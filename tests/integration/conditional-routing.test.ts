import { describe, it, expect } from 'vitest';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { computeNode, edge } from '../helpers/graph-builders.js';
import { mockExecutor } from '../helpers/mock-executor.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DSLEvaluator } from '@run-iq/core';
import type { DGGraph } from '../../src/types/graph.js';

const META: ExecutionMeta = {
  requestId: 'req-route-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

function trueDSL(): DSLEvaluator {
  return { dsl: 'test', version: '1.0', evaluate: () => true };
}

function falseDSL(): DSLEvaluator {
  return { dsl: 'test', version: '1.0', evaluate: () => false };
}

describe('conditional routing integration', () => {
  it('activates a node when edge condition is true', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
      },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'test', expression: { var: 'v' }, scope: 'source-output' }),
      ],
    };
    const compiled = compiler.compile(graph);
    const dsls = new Map([['test', trueDSL()]]);
    const orch = new DGOrchestrator(mockExecutor(), dsls, { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('a');
    expect(result.executed).toContain('b');
  });

  it('skips a node when edge condition is false', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
      },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'test', expression: { var: 'v' }, scope: 'source-output' }),
      ],
    };
    const compiled = compiler.compile(graph);
    const dsls = new Map([['test', falseDSL()]]);
    const orch = new DGOrchestrator(mockExecutor(), dsls, { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('a');
    expect(result.skipped).toContain('b');
  });

  it('skips cascade: b skipped → c also skipped', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'test', expression: false, scope: 'source-output' }),
        edge('e2', 'b', 'c'),
      ],
    };
    const compiled = compiler.compile(graph);
    const dsls = new Map([['test', falseDSL()]]);
    const orch = new DGOrchestrator(mockExecutor(), dsls, { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('a');
    expect(result.skipped).toContain('b');
    expect(result.skipped).toContain('c');
  });

  it('node with multiple incoming edges: at least one active', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [
        edge('e1', 'a', 'c', { dsl: 'test', expression: false, scope: 'source-output' }),
        edge('e2', 'b', 'c'), // unconditional
      ],
    };
    const compiled = compiler.compile(graph);
    const dsls = new Map([['test', falseDSL()]]);
    const orch = new DGOrchestrator(mockExecutor(), dsls, { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('c'); // active via e2 from b
  });

  it('edge with unknown DSL skips the node', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
      },
      edges: [
        edge('e1', 'a', 'b', { dsl: 'unknown-dsl', expression: true, scope: 'source-output' }),
      ],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });

    const result = await orch.execute(compiled, {}, META);

    expect(result.executed).toContain('a');
    expect(result.skipped).toContain('b');
  });
});
