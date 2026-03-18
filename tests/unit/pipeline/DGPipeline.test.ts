import { describe, it, expect, vi } from 'vitest';
import { DGPipeline } from '../../../src/pipeline/DGPipeline.js';
import type { OutputLayerHandler } from '../../../src/pipeline/OutputLayer.js';
import type { DGResult } from '../../../src/types/result.js';
import type { CompiledGraph } from '../../../src/types/compiled.js';
import type { DGOrchestrator } from '../../../src/orchestrator/DGOrchestrator.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function fakeDGResult(overrides: Partial<DGResult> = {}): DGResult {
  return {
    graphId: 'g1',
    graphHash: 'h1',
    requestId: 'req-1',
    status: 'completed',
    outputs: { overallRisk: 0.35 },
    executed: ['n1'],
    skipped: [],
    failed: [],
    events: [],
    durationMs: 100,
    versions: { dg: '0.1.0', contextEngine: '0.1.0', core: '0.2.5' },
    ...overrides,
  };
}

function fakeCompiled(): CompiledGraph {
  return {
    source: { id: 'g1', version: '1.0.0', nodes: {}, edges: [] },
    levels: [],
    wiring: new Map(),
    failures: new Map(),
    dslVars: new Map(),
    warnings: [],
    hash: 'h1',
    compiled: {
      at: new Date().toISOString(),
      dgVersion: '0.1.0',
      contextEngineVersion: '0.1.0',
      coreVersion: '0.2.5',
    },
  };
}

function mockOrchestrator(result: DGResult): DGOrchestrator {
  return {
    execute: vi.fn().mockResolvedValue(result),
  } as unknown as DGOrchestrator;
}

function makeHandler(
  name: string,
  canHandle: boolean,
  handleFn?: () => Promise<void>,
): OutputLayerHandler {
  return {
    name,
    canHandle: vi.fn().mockReturnValue(canHandle),
    handle: vi.fn(handleFn ?? (async () => {})),
  };
}

describe('DGPipeline', () => {
  it('executes DG and returns result with no handlers', async () => {
    const dgResult = fakeDGResult();
    const orchestrator = mockOrchestrator(dgResult);
    const pipeline = new DGPipeline(orchestrator, []);

    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(result.dgResult).toBe(dgResult);
    expect(result.handlers).toEqual([]);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('runs handlers that canHandle returns true', async () => {
    const dgResult = fakeDGResult();
    const handler = makeHandler('pdf', true);
    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [handler]);

    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(handler.handle).toHaveBeenCalledTimes(1);
    expect(result.handlers[0]!.name).toBe('pdf');
    expect(result.handlers[0]!.executed).toBe(true);
  });

  it('skips handlers that canHandle returns false', async () => {
    const dgResult = fakeDGResult();
    const handler = makeHandler('email', false);
    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [handler]);

    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(handler.handle).not.toHaveBeenCalled();
    expect(result.handlers[0]!.executed).toBe(false);
  });

  it('runs multiple handlers sequentially', async () => {
    const dgResult = fakeDGResult();
    const order: string[] = [];
    const h1 = makeHandler('pdf', true, async () => {
      order.push('pdf');
    });
    const h2 = makeHandler('email', true, async () => {
      order.push('email');
    });
    const h3 = makeHandler('archive', true, async () => {
      order.push('archive');
    });

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [h1, h2, h3]);
    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(order).toEqual(['pdf', 'email', 'archive']);
    expect(result.handlers).toHaveLength(3);
    expect(result.handlers.every((h) => h.executed)).toBe(true);
  });

  it('continues on handler error by default', async () => {
    const dgResult = fakeDGResult();
    const h1 = makeHandler('broken', true, async () => {
      throw new Error('PDF generation failed');
    });
    const h2 = makeHandler('email', true);

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [h1, h2]);
    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(result.handlers[0]!.error).toBe('PDF generation failed');
    expect(result.handlers[0]!.executed).toBe(true);
    expect(result.handlers[1]!.executed).toBe(true);
    expect(h2.handle).toHaveBeenCalledTimes(1);
  });

  it('aborts on handler error when abortOnError is true', async () => {
    const dgResult = fakeDGResult();
    const h1 = makeHandler('broken', true, async () => {
      throw new Error('fail');
    });
    const h2 = makeHandler('email', true);

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [h1, h2], {
      abortOnError: true,
    });
    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(result.handlers).toHaveLength(1);
    expect(result.handlers[0]!.error).toBe('fail');
    expect(h2.handle).not.toHaveBeenCalled();
  });

  it('passes correct context to handlers', async () => {
    const dgResult = fakeDGResult();
    const handler = makeHandler('audit', true);
    const meta: ExecutionMeta = {
      ...META,
      context: { env: 'production' },
    };

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [handler]);
    await pipeline.run(fakeCompiled(), {}, meta);

    const [, ctx] = (handler.handle as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(ctx.requestId).toBe('req-1');
    expect(ctx.tenantId).toBe('tenant-1');
    expect(ctx.meta).toEqual({ env: 'production' });
  });

  it('handler receives the DGResult', async () => {
    const dgResult = fakeDGResult({ outputs: { risk: 0.8 } });
    const handler = makeHandler('check', true);

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [handler]);
    await pipeline.run(fakeCompiled(), {}, META);

    const [receivedResult] = (handler.handle as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(receivedResult.outputs['risk']).toBe(0.8);
  });

  it('measures handler duration', async () => {
    const dgResult = fakeDGResult();
    const handler = makeHandler('slow', true, async () => {
      await new Promise((r) => setTimeout(r, 20));
    });

    const pipeline = new DGPipeline(mockOrchestrator(dgResult), [handler]);
    const result = await pipeline.run(fakeCompiled(), {}, META);

    expect(result.handlers[0]!.durationMs).toBeGreaterThanOrEqual(10);
  });

  it('propagates DG execution errors', async () => {
    const orchestrator = {
      execute: vi.fn().mockRejectedValue(new Error('DG failed')),
    } as unknown as DGOrchestrator;

    const pipeline = new DGPipeline(orchestrator, [makeHandler('h', true)]);

    await expect(pipeline.run(fakeCompiled(), {}, META)).rejects.toThrow('DG failed');
  });
});
