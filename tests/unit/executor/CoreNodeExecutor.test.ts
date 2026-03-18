import { describe, it, expect, vi } from 'vitest';
import { CoreNodeExecutor } from '../../../src/executor/CoreNodeExecutor.js';
import { DGMissingOutputError } from '../../../src/errors.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
  effectiveDate: '2025-06-15',
};

function node(id: string, outPorts: { name: string; required: boolean }[] = []): DGNode {
  return {
    id,
    type: 'compute',
    model: 'FLAT_RATE',
    ports: { in: [{ name: 'income', required: true }], out: outPorts },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

function mockResult(overrides: Record<string, unknown> = {}) {
  return {
    requestId: 'req-1:n',
    value: 42000,
    breakdown: [{ ruleId: 'r1', value: 42000 }],
    appliedRules: [{ id: 'r1' }],
    skippedRules: [],
    trace: { steps: [] },
    snapshotId: 'snap-1',
    engineVersion: '0.2.6',
    pluginVersions: {},
    dslVersions: {},
    timestamp: new Date(),
    meta: { fiscalBreakdown: { total: 42000 } },
    ...overrides,
  };
}

function makeMockEngine(result: ReturnType<typeof mockResult>) {
  return {
    evaluate: vi.fn().mockResolvedValue(result),
  };
}

function makeMockResolver(
  rules = [
    {
      id: 'r1',
      version: 1,
      model: 'FLAT_RATE',
      params: {},
      priority: 100,
      effectiveFrom: new Date(),
      effectiveUntil: null,
      tags: [],
      checksum: 'abc',
    },
  ],
) {
  return {
    resolve: vi.fn().mockResolvedValue(rules),
    fingerprint: vi.fn().mockReturnValue('fp'),
  };
}

describe('CoreNodeExecutor', () => {
  it('calls engine.evaluate with 2 args', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    await executor.execute(node('n', [{ name: 'value', required: true }]), { income: 1000 }, META);

    expect(engine.evaluate).toHaveBeenCalledTimes(1);
    const [rules, input] = engine.evaluate.mock.calls[0]!;
    expect(Array.isArray(rules)).toBe(true);
    expect(input.data).toEqual({ income: 1000 });
  });

  it('converts effectiveDate string to Date', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    await executor.execute(node('n', [{ name: 'value', required: true }]), {}, META);

    const [, input] = engine.evaluate.mock.calls[0]!;
    expect(input.meta.effectiveDate).toBeInstanceOf(Date);
    expect(input.meta.effectiveDate.toISOString()).toContain('2025-06-15');
  });

  it('maps value port to result.value', async () => {
    const engine = makeMockEngine(mockResult({ value: 99 }));
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(node('n', [{ name: 'value', required: true }]), {}, META);
    expect(result.outputs['value']).toBe(99);
  });

  it('maps breakdown port to result.breakdown', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(
      node('n', [{ name: 'breakdown', required: false }]),
      {},
      META,
    );
    expect(result.outputs['breakdown']).toBeDefined();
  });

  it('maps trace port to result.trace', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(
      node('n', [{ name: 'trace', required: false }]),
      {},
      META,
    );
    expect(result.outputs['trace']).toBeDefined();
  });

  it('maps applied port to result.appliedRules', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(
      node('n', [{ name: 'applied', required: false }]),
      {},
      META,
    );
    expect(result.outputs['applied']).toBeDefined();
  });

  it('maps unknown port to result.meta[portName]', async () => {
    const engine = makeMockEngine(mockResult({ meta: { fiscalBreakdown: { irpp: 5000 } } }));
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(
      node('n', [{ name: 'fiscalBreakdown', required: false }]),
      {},
      META,
    );
    expect(result.outputs['fiscalBreakdown']).toEqual({ irpp: 5000 });
  });

  it('throws DGMissingOutputError for required missing port', async () => {
    const engine = makeMockEngine(mockResult({ meta: undefined }));
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    await expect(
      executor.execute(node('n', [{ name: 'missingPort', required: true }]), {}, META),
    ).rejects.toThrow(DGMissingOutputError);
  });

  it('skips undefined optional ports', async () => {
    const engine = makeMockEngine(mockResult({ meta: undefined }));
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(
      node('n', [
        { name: 'value', required: true },
        { name: 'optPort', required: false },
      ]),
      {},
      META,
    );
    expect(result.outputs['optPort']).toBeUndefined();
  });

  it('returns raw result', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(node('n', [{ name: 'value', required: true }]), {}, META);
    expect(result.raw).toBeDefined();
  });

  it('returns durationMs', async () => {
    const engine = makeMockEngine(mockResult());
    const resolver = makeMockResolver();
    const executor = new CoreNodeExecutor(engine as never, resolver);

    const result = await executor.execute(node('n', [{ name: 'value', required: true }]), {}, META);
    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
