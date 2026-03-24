import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HttpNodeExecutor } from '../../../src/executor/HttpNodeExecutor.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { EnrichConfig } from '../../../src/types/enrich.js';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function enrichNode(
  id: string,
  cfgOverrides: Partial<EnrichConfig> = {},
  policyOverrides: Partial<DGNode['policy']> = {},
): DGNode {
  const cfg: EnrichConfig = {
    endpoint: 'https://api.example.com/data',
    timeoutMs: 3000,
    onFailure: 'fail',
    inputMapping: { nif: 'company.nif' },
    outputMapping: { regime: 'data.regime' },
    ...cfgOverrides,
  };
  return {
    id,
    type: 'enrich',
    ports: {
      in: [{ name: 'nif', required: true }],
      out: [{ name: 'regime', required: true }],
    },
    policy: { onError: 'fail', onFailPropagation: 'halt', ...policyOverrides },
    meta: { enrichConfig: cfg },
  };
}

function mockResponse(body: unknown, status = 200): Response {
  const text = JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    text: vi.fn().mockResolvedValue(text),
    headers: new Headers(),
  } as unknown as Response;
}

describe('HttpNodeExecutor', () => {
  let fetchFn: ReturnType<typeof vi.fn>;
  let executor: HttpNodeExecutor;

  beforeEach(() => {
    fetchFn = vi.fn();
    executor = new HttpNodeExecutor(fetchFn);
  });

  it('rejects non-enrich nodes', async () => {
    const node: DGNode = {
      id: 'n',
      type: 'compute',
      model: 'M',
      ports: { in: [], out: [] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
    };
    await expect(executor.execute(node, {}, META)).rejects.toThrow('expected node type "enrich"');
  });

  it('rejects node missing enrichConfig', async () => {
    const node: DGNode = {
      id: 'n',
      type: 'enrich',
      ports: { in: [], out: [] },
      policy: { onError: 'fail', onFailPropagation: 'halt' },
    };
    await expect(executor.execute(node, {}, META)).rejects.toThrow('missing meta.enrichConfig');
  });

  // --- GET ---

  it('sends GET with query params from inputMapping', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'simplified' } }));

    const result = await executor.execute(enrichNode('e1'), { company: { nif: '123456' } }, META);

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchFn.mock.calls[0]!;
    expect(url).toContain('nif=123456');
    expect(opts.method).toBe('GET');
    expect(result.outputs['regime']).toBe('simplified');
  });

  it('omits query param when input value is undefined', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'normal' } }));

    await executor.execute(enrichNode('e1'), {}, META);

    const [url] = fetchFn.mock.calls[0]!;
    expect(url).not.toContain('nif=');
  });

  // --- POST ---

  it('sends POST with JSON body from inputMapping', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'forfait' } }));
    const node = enrichNode('e1', { method: 'POST' });

    const result = await executor.execute(node, { company: { nif: '789' } }, META);

    const [url, opts] = fetchFn.mock.calls[0]!;
    expect(url).toBe('https://api.example.com/data');
    expect(opts.method).toBe('POST');
    expect(opts.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(opts.body)).toEqual({ nif: '789' });
    expect(result.outputs['regime']).toBe('forfait');
  });

  // --- Headers injection ---

  it('injects headers from meta.context.__enrichHeaders', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'rsi' } }));
    const meta: ExecutionMeta = {
      ...META,
      context: { __enrichHeaders: { Authorization: 'Bearer tok' } },
    };

    await executor.execute(enrichNode('e1'), { company: { nif: '1' } }, meta);

    const [, opts] = fetchFn.mock.calls[0]!;
    expect(opts.headers['Authorization']).toBe('Bearer tok');
  });

  // --- Output mapping ---

  it('maps nested response paths to output ports', async () => {
    fetchFn.mockResolvedValue(mockResponse({ result: { nested: { score: 85, label: 'A' } } }));
    const node = enrichNode('e1', {
      outputMapping: { score: 'result.nested.score', label: 'result.nested.label' },
    });

    const result = await executor.execute(node, { company: { nif: '1' } }, META);

    expect(result.outputs['score']).toBe(85);
    expect(result.outputs['label']).toBe('A');
  });

  it('returns undefined for missing response path', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: {} }));

    const result = await executor.execute(enrichNode('e1'), { company: { nif: '1' } }, META);

    expect(result.outputs['regime']).toBeUndefined();
  });

  // --- Error handling ---

  it('throws on 4xx and does NOT retry', async () => {
    fetchFn.mockResolvedValue(mockResponse({}, 404));

    const node = enrichNode('e1', { retry: 2 });
    await expect(executor.execute(node, { company: { nif: '1' } }, META)).rejects.toThrow(
      'HTTP 404',
    );
    expect(fetchFn).toHaveBeenCalledTimes(1); // No retries
  });

  it('retries on 5xx up to retry count', async () => {
    fetchFn
      .mockResolvedValueOnce(mockResponse({}, 500))
      .mockResolvedValueOnce(mockResponse({}, 502))
      .mockResolvedValueOnce(mockResponse({ data: { regime: 'ok' } }));

    const node = enrichNode('e1', { retry: 2 });
    const result = await executor.execute(node, { company: { nif: '1' } }, META);

    expect(fetchFn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(result.outputs['regime']).toBe('ok');
  });

  it('retries on network error', async () => {
    fetchFn
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(mockResponse({ data: { regime: 'ok' } }));

    const node = enrichNode('e1', { retry: 1 });
    const result = await executor.execute(node, { company: { nif: '1' } }, META);

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(result.outputs['regime']).toBe('ok');
  });

  it('throws after all retries exhausted on 5xx', async () => {
    fetchFn.mockResolvedValue(mockResponse({}, 503));

    const node = enrichNode('e1', { retry: 1 });
    await expect(executor.execute(node, { company: { nif: '1' } }, META)).rejects.toThrow(
      'HTTP 503',
    );
    expect(fetchFn).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
  });

  // --- Fallback ---

  it('returns fallback on failure when onFailure=fallback', async () => {
    fetchFn.mockResolvedValue(mockResponse({}, 500));

    const node = enrichNode(
      'e1',
      { onFailure: 'fallback', retry: 0 },
      { onError: 'fallback', onFailPropagation: 'continue', fallback: { regime: 'default' } },
    );

    const result = await executor.execute(node, { company: { nif: '1' } }, META);

    expect(result.outputs['regime']).toBe('default');
    expect((result.raw as Record<string, unknown>)['error']).toBeDefined();
    expect(result.usedFallback).toBe(true);
  });

  // --- Response size limit ---

  it('throws when response exceeds responseMaxBytes', async () => {
    const largeBody = 'x'.repeat(200);
    fetchFn.mockResolvedValue({
      status: 200,
      ok: true,
      text: vi.fn().mockResolvedValue(largeBody),
      headers: new Headers(),
    });

    const node = enrichNode('e1', { responseMaxBytes: 100 });
    await expect(executor.execute(node, { company: { nif: '1' } }, META)).rejects.toThrow(
      'exceeds max size',
    );
  });

  // --- Timeout (abort signal) ---

  it('passes AbortSignal to fetch', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'ok' } }));

    await executor.execute(enrichNode('e1'), { company: { nif: '1' } }, META);

    const [, opts] = fetchFn.mock.calls[0]!;
    expect(opts.signal).toBeDefined();
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  // --- Raw audit data ---

  it('includes request and response metadata in raw', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'ok' } }));

    const result = await executor.execute(enrichNode('e1'), { company: { nif: '1' } }, META);

    const raw = result.raw as Record<string, unknown>;
    expect(raw['request']).toBeDefined();
    expect((raw['request'] as Record<string, unknown>)['method']).toBe('GET');
    expect((raw['response'] as Record<string, unknown>)['statusCode']).toBe(200);
  });

  // --- Duration ---

  it('returns durationMs', async () => {
    fetchFn.mockResolvedValue(mockResponse({ data: { regime: 'ok' } }));

    const result = await executor.execute(enrichNode('e1'), { company: { nif: '1' } }, META);

    expect(typeof result.durationMs).toBe('number');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  // --- No retries by default ---

  it('does not retry when retry is not set (default 0)', async () => {
    fetchFn.mockResolvedValue(mockResponse({}, 500));

    const node = enrichNode('e1'); // retry defaults to 0
    await expect(executor.execute(node, {}, META)).rejects.toThrow('HTTP 500');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
