import { describe, it, expect, vi } from 'vitest';
import { SubGraphExecutor } from '../../../src/executor/SubGraphExecutor.js';
import type { SubGraphRunner } from '../../../src/executor/SubGraphExecutor.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { CompiledGraph } from '../../../src/types/compiled.js';
import type { DGResult } from '../../../src/types/result.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-parent',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function subgraphNode(
  id: string,
  graphId: string,
  inputMapping: Record<string, string> = {},
  outputMapping: Record<string, string> = { score: 'score' },
): DGNode {
  return {
    id,
    type: 'subgraph',
    ports: {
      in: [{ name: 'data', required: true }],
      out: [{ name: 'score', required: true }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
    meta: { subGraphConfig: { graphId, inputMapping, outputMapping } },
  };
}

function fakeCompiled(graphId: string): CompiledGraph {
  return {
    source: { id: graphId, version: '1.0.0', nodes: {}, edges: [] },
    levels: [],
    wiring: new Map(),
    failures: new Map(),
    dslVars: new Map(),
    warnings: [],
    hash: 'abc123',
    compiled: {
      at: new Date().toISOString(),
      dgVersion: '0.1.0',
      contextEngineVersion: '0.1.0',
      coreVersion: '0.2.5',
    },
  };
}

function fakeDGResult(graphId: string, outputs: Record<string, unknown> = {}): DGResult {
  return {
    graphId,
    graphHash: 'abc123',
    requestId: 'req-child',
    status: 'completed',
    outputs,
    executed: ['n1', 'n2'],
    skipped: [],
    failed: [],
    events: [],
    durationMs: 42,
    versions: { dg: '0.1.0', contextEngine: '0.1.0', core: '0.2.5' },
  };
}

describe('SubGraphExecutor', () => {
  it('rejects non-subgraph nodes', async () => {
    const runner = vi.fn();
    const executor = new SubGraphExecutor(new Map(), runner);
    const node: DGNode = {
      id: 'n',
      type: 'compute',
      model: 'M',
      ports: { in: [], out: [] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
    };
    await expect(executor.execute(node, {}, META)).rejects.toThrow('expected node type "subgraph"');
  });

  it('rejects node missing subGraphConfig', async () => {
    const runner = vi.fn();
    const executor = new SubGraphExecutor(new Map(), runner);
    const node: DGNode = {
      id: 'n',
      type: 'subgraph',
      ports: { in: [], out: [] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
    };
    await expect(executor.execute(node, {}, META)).rejects.toThrow('missing meta.subGraphConfig');
  });

  it('rejects unknown graphId', async () => {
    const runner = vi.fn();
    const executor = new SubGraphExecutor(new Map(), runner);
    const node = subgraphNode('sg', 'unknown-graph');
    await expect(executor.execute(node, {}, META)).rejects.toThrow('not found in registered');
  });

  it('runs sub-DG and maps outputs', async () => {
    const compiled = fakeCompiled('DG_Financial');
    const runner: SubGraphRunner = vi
      .fn()
      .mockResolvedValue(fakeDGResult('DG_Financial', { score: 85, extra: 'ignored' }));

    const executor = new SubGraphExecutor(new Map([['DG_Financial', compiled]]), runner);

    const node = subgraphNode(
      'financial',
      'DG_Financial',
      { nif: 'enterprise.nif' },
      { score: 'score' },
    );

    const result = await executor.execute(node, { enterprise: { nif: '12345' } }, META);

    expect(result.outputs['score']).toBe(85);
    expect(result.outputs['extra']).toBeUndefined(); // not in outputMapping
  });

  it('maps inputs from parent context via inputMapping', async () => {
    const compiled = fakeCompiled('DG_Legal');
    const runner = vi.fn().mockResolvedValue(fakeDGResult('DG_Legal', { legalScore: 90 }));

    const executor = new SubGraphExecutor(new Map([['DG_Legal', compiled]]), runner);

    const node = subgraphNode(
      'legal',
      'DG_Legal',
      { companyId: 'company.id', country: 'company.country' },
      { legalScore: 'legalScore' },
    );

    await executor.execute(node, { company: { id: 'C001', country: 'TG' } }, META);

    const [, subInput] = (runner as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(subInput).toEqual({ companyId: 'C001', country: 'TG' });
  });

  it('creates child requestId with sg: prefix', async () => {
    const compiled = fakeCompiled('DG_Sector');
    const runner = vi.fn().mockResolvedValue(fakeDGResult('DG_Sector', { sectorScore: 70 }));

    const executor = new SubGraphExecutor(new Map([['DG_Sector', compiled]]), runner);

    const node = subgraphNode('sector', 'DG_Sector', {}, { sectorScore: 'sectorScore' });

    await executor.execute(node, {}, META);

    const [, , childMeta] = (runner as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(childMeta.requestId).toBe('req-parent:sg:sector');
  });

  it('includes audit summary in raw', async () => {
    const compiled = fakeCompiled('DG_Financial');
    const runner: SubGraphRunner = vi
      .fn()
      .mockResolvedValue(fakeDGResult('DG_Financial', { score: 85 }));

    const executor = new SubGraphExecutor(new Map([['DG_Financial', compiled]]), runner);
    const node = subgraphNode('fin', 'DG_Financial', {}, { score: 'score' });

    const result = await executor.execute(node, {}, META);

    const raw = result.raw as Record<string, unknown>;
    expect(raw['subGraphId']).toBe('DG_Financial');
    expect(raw['subGraphStatus']).toBe('completed');
    expect(raw['executed']).toBe(2);
    expect(raw['failed']).toBe(0);
  });

  it('returns durationMs', async () => {
    const compiled = fakeCompiled('DG_Quick');
    const runner: SubGraphRunner = vi.fn().mockResolvedValue(fakeDGResult('DG_Quick', { v: 1 }));

    const executor = new SubGraphExecutor(new Map([['DG_Quick', compiled]]), runner);
    const node = subgraphNode('q', 'DG_Quick', {}, { v: 'v' });

    const result = await executor.execute(node, {}, META);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('propagates sub-DG runner errors', async () => {
    const compiled = fakeCompiled('DG_Broken');
    const runner: SubGraphRunner = vi.fn().mockRejectedValue(new Error('sub-DG exploded'));

    const executor = new SubGraphExecutor(new Map([['DG_Broken', compiled]]), runner);
    const node = subgraphNode('broken', 'DG_Broken', {}, { v: 'v' });

    await expect(executor.execute(node, {}, META)).rejects.toThrow('sub-DG exploded');
  });

  it('handles undefined input paths gracefully', async () => {
    const compiled = fakeCompiled('DG_Sparse');
    const runner = vi.fn().mockResolvedValue(fakeDGResult('DG_Sparse', { v: 1 }));

    const executor = new SubGraphExecutor(new Map([['DG_Sparse', compiled]]), runner);
    const node = subgraphNode('sparse', 'DG_Sparse', { missing: 'no.such.path' }, { v: 'v' });

    await executor.execute(node, {}, META);

    const [, subInput] = (runner as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(subInput['missing']).toBeUndefined();
  });
});
