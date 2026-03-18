import { describe, it, expect, vi } from 'vitest';
import { extractInputs, injectOutputs, runNode } from '../../../src/orchestrator/nodeRunner.js';
import { DGContext } from '../../../src/context/DGContext.js';
import { DGMissingInputError, DGOutputSizeError } from '../../../src/errors.js';
import type { DGNode } from '../../../src/types/graph.js';
import type { WiringMap } from '../../../src/types/ports.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: new Date().toISOString(),
};

function node(
  id: string,
  inPorts: { name: string; required: boolean; default?: unknown }[] = [],
  outPorts: { name: string; required: boolean }[] = [],
  policyOverrides: Record<string, unknown> = {},
): DGNode {
  return {
    id,
    type: 'compute',
    model: 'M',
    ports: { in: inPorts, out: outPorts },
    policy: { onError: 'fail', onFailPropagation: 'halt', ...policyOverrides },
  };
}

describe('extractInputs', () => {
  it('extracts wired inputs from context', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.set('a', 'value', 42);

    const n = node('b', [{ name: 'value', required: true }]);
    const wiring: WiringMap = new Map([
      ['b', [{ fromNode: 'a', fromPort: 'value', toNode: 'b', toPort: 'value' }]],
    ]);

    const inputs = extractInputs(n, wiring, ctx);
    expect(inputs['value']).toBe(42);
  });

  it('extracts from input namespace for root nodes', () => {
    const ctx = new DGContext({ income: 1000 }, META, { logLevel: 'verbose' });
    const n = node('a', [{ name: 'income', required: true }]);
    const wiring: WiringMap = new Map([
      ['a', [{ fromNode: 'input', fromPort: 'income', toNode: 'a', toPort: 'income' }]],
    ]);

    const inputs = extractInputs(n, wiring, ctx);
    expect(inputs['income']).toBe(1000);
  });

  it('uses port default when wired value missing', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [{ name: 'rate', required: false, default: 0.1 }]);
    const wiring: WiringMap = new Map([['a', []]]);

    const inputs = extractInputs(n, wiring, ctx);
    expect(inputs['rate']).toBe(0.1);
  });

  it('throws DGMissingInputError for required port without value', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [{ name: 'income', required: true }]);
    const wiring: WiringMap = new Map([['a', []]]);

    expect(() => extractInputs(n, wiring, ctx)).toThrow(DGMissingInputError);
  });

  it('skips optional port without value or default', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [{ name: 'extra', required: false }]);
    const wiring: WiringMap = new Map([['a', []]]);

    const inputs = extractInputs(n, wiring, ctx);
    expect(inputs['extra']).toBeUndefined();
  });

  it('respects aliasedAs on wiring', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    ctx.set('a', 'tax', 5000);

    const n = node('b', [{ name: 'amount', required: true }]);
    const wiring: WiringMap = new Map([
      [
        'b',
        [{ fromNode: 'a', fromPort: 'tax', toNode: 'b', toPort: 'amount', aliasedAs: 'taxAmount' }],
      ],
    ]);

    const inputs = extractInputs(n, wiring, ctx);
    expect(inputs['taxAmount']).toBe(5000);
  });
});

describe('injectOutputs', () => {
  it('sets outputs in context', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [], [{ name: 'value', required: true }]);
    injectOutputs(n, { value: 42 }, ctx);
    expect(ctx.get('a.value')).toBe(42);
  });

  it('throws DGOutputSizeError when output exceeds max', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [], [{ name: 'value', required: true }], { maxOutputSizeKb: 0.001 });
    const bigValue = 'x'.repeat(100);
    expect(() => injectOutputs(n, { value: bigValue }, ctx)).toThrow(DGOutputSizeError);
  });

  it('allows output within size limit', () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [], [{ name: 'value', required: true }], { maxOutputSizeKb: 512 });
    expect(() => injectOutputs(n, { value: 42 }, ctx)).not.toThrow();
  });
});

describe('runNode', () => {
  it('executes node and emits started+completed events', async () => {
    const ctx = new DGContext({ income: 1000 }, META, { logLevel: 'verbose' });
    const n = node('a', [{ name: 'income', required: true }], [{ name: 'value', required: true }]);
    const wiring: WiringMap = new Map([
      ['a', [{ fromNode: 'input', fromPort: 'income', toNode: 'a', toPort: 'income' }]],
    ]);

    const executor = {
      execute: vi.fn().mockResolvedValue({ outputs: { value: 42 }, durationMs: 5 }),
    };

    await runNode(n, wiring, ctx, executor, META);

    expect(ctx.isCompleted('a')).toBe(true);
    expect(ctx.get('a.value')).toBe(42);
    const events = ctx.getEvents();
    expect(events.some((e) => e.type === 'node.started')).toBe(true);
    expect(events.some((e) => e.type === 'node.completed')).toBe(true);
  });

  it('stores raw when storeRaw is true', async () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [], [{ name: 'value', required: true }], { storeRaw: true });
    const wiring: WiringMap = new Map([['a', []]]);

    const executor = {
      execute: vi
        .fn()
        .mockResolvedValue({ outputs: { value: 1 }, raw: { full: 'result' }, durationMs: 1 }),
    };

    await runNode(n, wiring, ctx, executor, META);
    expect(ctx.get('a.__raw')).toEqual({ full: 'result' });
    expect(ctx.getEvents().some((e) => e.type === 'node.raw_stored')).toBe(true);
  });

  it('does not store raw when storeRaw is false', async () => {
    const ctx = new DGContext({}, META, { logLevel: 'verbose' });
    const n = node('a', [], [{ name: 'value', required: true }]);
    const wiring: WiringMap = new Map([['a', []]]);

    const executor = {
      execute: vi
        .fn()
        .mockResolvedValue({ outputs: { value: 1 }, raw: { full: 'result' }, durationMs: 1 }),
    };

    await runNode(n, wiring, ctx, executor, META);
    expect(ctx.has('a.__raw')).toBe(false);
  });
});
