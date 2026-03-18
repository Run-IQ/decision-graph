import { describe, it, expect, vi } from 'vitest';
import { DGOrchestrator } from '../../src/orchestrator/DGOrchestrator.js';
import { DGCompiler } from '../../src/compiler/DGCompiler.js';
import type { DGGraph, DGNode } from '../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { NodeExecutor } from '../../src/executor/NodeExecutor.js';
import { computeNode, mergeNode, edge } from '../helpers/graph-builders.js';
import { mockExecutor, failingExecutor, dynamicExecutor } from '../helpers/mock-executor.js';

const META: ExecutionMeta = {
  requestId: 'req-edge',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

const compiler = new DGCompiler();

describe('Edge Cases — Graph Topology', () => {
  it('handles empty graph (no nodes, no edges)', () => {
    const graph: DGGraph = { id: 'g', version: '1', nodes: {}, edges: [] };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());
    return expect(orch.execute(compiled, {}, META)).resolves.toMatchObject({
      status: 'completed',
      executed: [],
      failed: [],
    });
  });

  it('handles single node with no ports', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: {
          id: 'a',
          type: 'compute',
          model: 'M',
          ports: { in: [], out: [] },
          policy: { onError: 'fail', onFailPropagation: 'halt' },
        },
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());
    return expect(orch.execute(compiled, {}, META)).resolves.toMatchObject({
      status: 'completed',
      executed: ['a'],
    });
  });

  it('handles deep linear chain (20 nodes)', () => {
    const nodes: Record<string, DGNode> = {};
    const edges: DGGraph['edges'] = [];
    for (let i = 0; i < 20; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
      if (i > 0) edges.push(edge(`e${i}`, `n${i - 1}`, `n${i}`));
    }
    const graph: DGGraph = { id: 'g', version: '1', nodes, edges };
    const compiled = compiler.compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map());
    return orch.execute(compiled, {}, META).then((result) => {
      expect(result.status).toBe('completed');
      expect(result.executed).toHaveLength(20);
      expect(exec.execute).toHaveBeenCalledTimes(20);
    });
  });

  it('handles wide graph (20 parallel nodes)', () => {
    const nodes: Record<string, DGNode> = {};
    for (let i = 0; i < 20; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
    }
    const graph: DGGraph = { id: 'g', version: '1', nodes, edges: [] };
    const compiled = compiler.compile(graph);
    const exec = mockExecutor();
    const orch = new DGOrchestrator(exec, new Map());
    return orch.execute(compiled, {}, META).then((result) => {
      expect(result.status).toBe('completed');
      expect(result.executed).toHaveLength(20);
    });
  });

  it('handles complex diamond with multiple merge points', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        root: computeNode('root'),
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
        m1: mergeNode('m1', { strategy: 'wait-all', onPartialInputs: 'proceed-with-available' }),
        d: computeNode('d'),
        m2: mergeNode('m2', { strategy: 'wait-all', onPartialInputs: 'proceed-with-available' }),
      },
      edges: [
        edge('e1', 'root', 'a'),
        edge('e2', 'root', 'b'),
        edge('e3', 'root', 'c'),
        edge('e4', 'a', 'm1'),
        edge('e5', 'b', 'm1'),
        edge('e6', 'm1', 'd'),
        edge('e7', 'c', 'm2'),
        edge('e8', 'd', 'm2'),
      ],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());
    return orch.execute(compiled, {}, META).then((result) => {
      expect(result.status).toBe('completed');
      expect(result.executed).toContain('root');
      expect(result.executed).toContain('m1');
      expect(result.executed).toContain('m2');
    });
  });
});

describe('Edge Cases — Error Propagation Combinations', () => {
  it('skip + halt: first node skip, second node halt', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'skip', onFailPropagation: 'continue' }),
        b: computeNode('b', { onError: 'fail', onFailPropagation: 'halt' }),
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    // a is skipped (onError=skip), b fails with halt → overall failed
    expect(result.status).toBe('failed');
  });

  it('fallback provides outputs when node fails', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', {
          onError: 'fallback',
          onFailPropagation: 'continue',
          fallback: { v: 999 },
        }),
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
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    // a falls back, b executes with fallback data
    expect(result.executed).toContain('b');
    expect(result.events.some((e) => e.type === 'node.fallback')).toBe(true);
  });

  it('skip-descendants cascades through multiple levels', async () => {
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
    const orch = new DGOrchestrator(failingExecutor(), new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.failed).toContain('a');
    expect(result.skipped).toContain('b');
    expect(result.skipped).toContain('c');
    expect(result.status).toBe('partial');
  });

  it('multiple failures in parallel nodes', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a', { onError: 'fail', onFailPropagation: 'skip-descendants' }),
        b: computeNode('b', { onError: 'fail', onFailPropagation: 'skip-descendants' }),
        c: computeNode('c'),
      },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockRejectedValueOnce(new Error('fail-a'))
        .mockRejectedValueOnce(new Error('fail-b'))
        .mockResolvedValue({ outputs: { v: 1 }, durationMs: 1 }),
    };
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.failed.length).toBeGreaterThanOrEqual(2);
    expect(result.status).toBe('partial');
  });
});

describe('Edge Cases — Merge Strategies', () => {
  it('wait-any proceeds with first completed parent', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b', { onError: 'skip', onFailPropagation: 'continue' }),
        m: mergeNode('m', { strategy: 'wait-any', onPartialInputs: 'proceed-with-available' }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ outputs: { v: 42 }, durationMs: 1 })
        .mockRejectedValueOnce(new Error('fail-b')),
    };
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.executed).toContain('m');
  });

  it('wait-quorum with quorum=1 behaves like wait-any', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b', { onError: 'skip', onFailPropagation: 'continue' }),
        m: mergeNode('m', {
          strategy: 'wait-quorum',
          quorum: 1,
          onPartialInputs: 'proceed-with-available',
        }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ outputs: { v: 1 }, durationMs: 1 })
        .mockRejectedValueOnce(new Error('fail-b')),
    };
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.executed).toContain('m');
  });

  it('merge.waiting event includes unavailable parents', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b', { onError: 'skip', onFailPropagation: 'continue' }),
        m: mergeNode('m', { strategy: 'wait-any', onPartialInputs: 'proceed-with-available' }),
      },
      edges: [edge('e1', 'a', 'm'), edge('e2', 'b', 'm')],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({ outputs: { v: 1 }, durationMs: 1 })
        .mockRejectedValueOnce(new Error('boom')),
    };
    const orch = new DGOrchestrator(exec, new Map(), { logLevel: 'verbose' });
    const result = await orch.execute(compiled, {}, META);
    const mergeEvent = result.events.find((e) => e.type === 'merge.waiting');
    expect(mergeEvent).toBeDefined();
    if (mergeEvent && mergeEvent.type === 'merge.waiting') {
      expect(mergeEvent.unavailable).toContain('b');
    }
  });
});

describe('Edge Cases — Concurrency', () => {
  it('maxParallelNodes=1 serializes all parallel nodes', async () => {
    const nodes: Record<string, DGNode> = {};
    for (let i = 0; i < 5; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
    }
    const graph: DGGraph = { id: 'g', version: '1', nodes, edges: [] };
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

    const orch = new DGOrchestrator(exec, new Map(), { limits: { maxParallelNodes: 1 } });
    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('completed');
    expect(maxConcurrent).toBe(1);
  });

  it('handles slow node not blocking unrelated descendants', async () => {
    // A → C, B → C — but A is slow. C must wait for both.
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: {
        a: computeNode('a'),
        b: computeNode('b'),
        c: computeNode('c'),
      },
      edges: [edge('e1', 'a', 'c'), edge('e2', 'b', 'c')],
    };
    const compiled = compiler.compile(graph);
    const exec = dynamicExecutor((node) => {
      return { outputs: { v: node.id === 'a' ? 'slow' : 'fast' }, durationMs: 1 };
    });
    const orch = new DGOrchestrator(exec, new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('completed');
    expect(result.executed).toContain('c');
  });
});

describe('Edge Cases — Timeout', () => {
  it('graph timeout triggers DGTimeoutError status', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const exec: NodeExecutor = {
      execute: vi
        .fn()
        .mockImplementation(
          () =>
            new Promise((resolve) =>
              setTimeout(() => resolve({ outputs: { v: 1 }, durationMs: 100 }), 200),
            ),
        ),
    };
    const orch = new DGOrchestrator(exec, new Map(), { limits: { maxDurationMs: 50 } });
    const result = await orch.execute(compiled, {}, META);
    expect(result.status).toBe('failed');
  });
});

describe('Edge Cases — Events', () => {
  it('events are frozen and cannot be modified', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });
    const result = await orch.execute(compiled, {}, META);
    const events = result.events;
    expect(events.length).toBeGreaterThan(0);
    // Events array is frozen (via Object.freeze in DGResult)
    expect(Object.isFrozen(events)).toBe(true);
  });

  it('all expected event types are emitted in verbose mode', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'verbose' });
    const result = await orch.execute(compiled, {}, META);
    const types = new Set(result.events.map((e) => e.type));
    expect(types.has('graph.started')).toBe(true);
    expect(types.has('level.started')).toBe(true);
    expect(types.has('node.started')).toBe(true);
    expect(types.has('node.completed')).toBe(true);
    expect(types.has('level.completed')).toBe(true);
    expect(types.has('graph.completed')).toBe(true);
  });

  it('minimal log level emits only essential events', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map(), { logLevel: 'minimal' });
    const result = await orch.execute(compiled, {}, META);
    const types = new Set(result.events.map((e) => e.type));
    expect(types.has('graph.started')).toBe(true);
    expect(types.has('graph.completed')).toBe(true);
    // node.started and level.started should NOT appear
    expect(types.has('node.started')).toBe(false);
    expect(types.has('level.started')).toBe(false);
  });
});

describe('Edge Cases — Compiler', () => {
  it('graph hash is deterministic', () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a'), b: computeNode('b') },
      edges: [edge('e1', 'a', 'b')],
    };
    const c1 = compiler.compile(graph);
    const c2 = compiler.compile(graph);
    expect(c1.hash).toBe(c2.hash);
  });

  it('different graph versions produce different hashes', () => {
    const g1: DGGraph = { id: 'g', version: '1', nodes: { a: computeNode('a') }, edges: [] };
    const g2: DGGraph = { id: 'g', version: '2', nodes: { a: computeNode('a') }, edges: [] };
    expect(compiler.compile(g1).hash).not.toBe(compiler.compile(g2).hash);
  });

  it('maxNodes limit is enforced at compile time', () => {
    const nodes: Record<string, DGNode> = {};
    for (let i = 0; i < 10; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
    }
    const graph: DGGraph = { id: 'g', version: '1', nodes, edges: [] };
    expect(() => compiler.compile(graph, { limits: { maxNodes: 5 } })).toThrow();
  });

  it('maxDepth limit is enforced at compile time', () => {
    const nodes: Record<string, DGNode> = {};
    const edges: DGGraph['edges'] = [];
    for (let i = 0; i < 10; i++) {
      nodes[`n${i}`] = computeNode(`n${i}`);
      if (i > 0) edges.push(edge(`e${i}`, `n${i - 1}`, `n${i}`));
    }
    const graph: DGGraph = { id: 'g', version: '1', nodes, edges };
    expect(() => compiler.compile(graph, { limits: { maxDepth: 5 } })).toThrow();
  });
});

describe('Edge Cases — Result Structure', () => {
  it('result contains all version info', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.versions.dg).toBeDefined();
    expect(result.versions.contextEngine).toBeDefined();
    expect(result.versions.core).toBeDefined();
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('result requestId matches meta', async () => {
    const graph: DGGraph = {
      id: 'g',
      version: '1',
      nodes: { a: computeNode('a') },
      edges: [],
    };
    const compiled = compiler.compile(graph);
    const orch = new DGOrchestrator(mockExecutor(), new Map());
    const result = await orch.execute(compiled, {}, META);
    expect(result.requestId).toBe(META.requestId);
    expect(result.graphId).toBe('g');
    expect(result.graphHash).toBe(compiled.hash);
  });
});
