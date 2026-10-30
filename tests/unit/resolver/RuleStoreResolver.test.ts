import { describe, it, expect, vi } from 'vitest';
import { PPEEngine } from '@run-iq/core';
import type { CalculationModel, PPEPlugin } from '@run-iq/core';
import { InMemoryRuleStore } from '@run-iq/context-engine';
import type { ExecutionMeta, RuleInput, RuleQuery, SerializedRule } from '@run-iq/context-engine';
import { SpecError } from '@run-iq/spec';
import { RuleStoreResolver } from '../../../src/resolver/RuleStoreResolver.js';
import { CoreNodeExecutor } from '../../../src/executor/CoreNodeExecutor.js';
import { DGCompiler } from '../../../src/compiler/DGCompiler.js';
import { DGOrchestrator } from '../../../src/orchestrator/DGOrchestrator.js';
import type { DGGraph, DGNode } from '../../../src/types/graph.js';

const META: ExecutionMeta = {
  requestId: 'req-1',
  tenantId: 'tenant-1',
  timestamp: '2025-06-15T00:00:00Z',
  effectiveDate: '2025-06-15',
};

function node(id: string): DGNode {
  return {
    id,
    type: 'compute',
    model: 'FLAT_RATE',
    ports: { in: [], out: [] },
    policy: { onError: 'fail', onFailPropagation: 'halt' },
  };
}

const RULE_INPUT: RuleInput = {
  id: 'r1',
  model: 'FLAT_RATE',
  tenantId: 'tenant-1',
  scope: 'tenant-specific',
  effectiveFrom: '2025-01-01',
  priority: 100,
  tags: ['fiscal'],
  payload: JSON.stringify({ params: { rate: 0.1, base: 'income' } }),
  createdBy: 'system',
};

/** A real stored record, as `InMemoryRuleStore.saveRule` writes it. */
async function storedRecord(overrides: Partial<RuleInput> = {}): Promise<SerializedRule> {
  return new InMemoryRuleStore().saveRule({ ...RULE_INPUT, ...overrides });
}

async function makeMockStore(records?: SerializedRule[]) {
  const resolved = records ?? [await storedRecord()];
  return {
    resolveRules: vi.fn().mockResolvedValue(resolved),
    fingerprint: vi.fn().mockReturnValue('fp-hash'),
    getRule: vi.fn(),
    listRules: vi.fn(),
    getRuleHistory: vi.fn(),
    getRulesAtDate: vi.fn(),
    saveRule: vi.fn(),
    updateRuleStatus: vi.fn(),
    deleteRule: vi.fn(),
  };
}

/** Alters the payload of every record after it was saved; the checksum is left as stored. */
function tamperPayloads(store: InMemoryRuleStore): void {
  const resolveRules = store.resolveRules.bind(store);
  store.resolveRules = async (query: RuleQuery) =>
    (await resolveRules(query)).map((record) => {
      const payload = record.payload.replace('"rate":0.05', '"rate":0.5');
      expect(payload).not.toBe(record.payload);
      return { ...record, payload };
    });
}

function percentagePlugin(): PPEPlugin {
  const percentage: CalculationModel = {
    name: 'PERCENTAGE',
    version: '1.0.0',
    validateParams: () => ({ valid: true }),
    calculate: (input, _rule, params) => {
      const { base, rate } = params as { base: string; rate: number };
      return Number(input[base]) * rate;
    },
  };
  return {
    name: 'percentage-test',
    version: '1.0.0',
    onInit: (ctx) => ctx.modelRegistry.register(percentage),
  };
}

async function publishedShippingFee(): Promise<InMemoryRuleStore> {
  const store = new InMemoryRuleStore();
  const saved = await store.saveRule({
    id: 'shipping-fee',
    model: 'PERCENTAGE',
    tenantId: 'acme',
    scope: 'tenant-specific',
    effectiveFrom: '2025-01-01',
    payload: JSON.stringify({ params: { base: 'orderTotal', rate: 0.05 } }),
    createdBy: 'alice',
  });
  await store.updateRuleStatus('shipping-fee', saved.version, 'review', 'alice');
  await store.publishRule('shipping-fee', saved.version, 'bob');
  return store;
}

const SHIPPING_META: ExecutionMeta = {
  requestId: 'order-42',
  tenantId: 'acme',
  timestamp: '2025-06-01T00:00:00.000Z',
  effectiveDate: '2025-06-01',
};

const SHIPPING_NODE: DGNode = {
  id: 'shipping',
  type: 'compute',
  model: 'PERCENTAGE',
  policy: { onError: 'fail', onFailPropagation: 'halt' },
  ports: {
    in: [{ name: 'orderTotal', required: true }],
    out: [{ name: 'value', required: true }],
  },
};

describe('RuleStoreResolver', () => {
  it('resolves rules from store', async () => {
    const record = await storedRecord();
    const store = await makeMockStore([record]);
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe('r1');
    expect(rules[0]!.version).toBe(1);
    expect(rules[0]!.model).toBe('FLAT_RATE');
    expect(rules[0]!.checksum).toBe(record.checksum);
  });

  it('converts the stored record to an executable rule', async () => {
    const store = await makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules[0]!.effectiveFrom).toBeInstanceOf(Date);
    expect(rules[0]!.effectiveFrom.toISOString()).toBe('2025-01-01T00:00:00.000Z');
    expect(rules[0]!.effectiveUntil).toBeNull();
    expect(rules[0]!.params).toEqual({ rate: 0.1, base: 'income' });
    expect(rules[0]!.priority).toBe(100);
    expect(rules[0]!.tags).toEqual(['fiscal']);
  });

  it('passes correct query to store', async () => {
    const store = await makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    await resolver.resolve(node('n'), META);
    expect(store.resolveRules).toHaveBeenCalledWith({
      tenantId: 'tenant-1',
      model: 'FLAT_RATE',
      effectiveDate: '2025-06-15',
      nodeId: 'n',
    });
  });

  it('returns fingerprint from store', async () => {
    const store = await makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    expect(resolver.fingerprint(node('n'), META)).toBe('fp-hash');
  });

  it('uses timestamp when effectiveDate missing', async () => {
    const store = await makeMockStore();
    const resolver = new RuleStoreResolver(store as never);
    const metaNoDate: ExecutionMeta = { requestId: 'r', tenantId: 't', timestamp: '2025-03-01' };
    await resolver.resolve(node('n'), metaNoDate);
    expect(store.resolveRules).toHaveBeenCalledWith(
      expect.objectContaining({ effectiveDate: '2025-03-01' }),
    );
  });

  it('handles effectiveUntil', async () => {
    const store = await makeMockStore([await storedRecord({ effectiveUntil: '2025-12-31' })]);
    const resolver = new RuleStoreResolver(store as never);
    const rules = await resolver.resolve(node('n'), META);
    expect(rules[0]!.effectiveUntil).toBeInstanceOf(Date);
    expect(rules[0]!.effectiveUntil!.toISOString()).toBe('2025-12-31T00:00:00.000Z');
  });

  it('resolves a saved rule that core applies', async () => {
    const store = await publishedShippingFee();
    const rules = await new RuleStoreResolver(store).resolve(SHIPPING_NODE, SHIPPING_META);
    const engine = new PPEEngine({ plugins: [percentagePlugin()], dsls: [] });

    const result = await engine.evaluate(rules, {
      data: { orderTotal: 200 },
      requestId: 'order-42:shipping',
      meta: { tenantId: 'acme', effectiveDate: new Date('2025-06-01') },
    });

    expect(result.skippedRules).toEqual([]);
    expect(result.appliedRules.map((r) => r.id)).toEqual(['shipping-fee']);
    expect(result.value).toBe(10);
  });

  it('keeps the fields of the stored definition, so core accepts its checksum', async () => {
    const store = new InMemoryRuleStore();
    const saved = await store.saveRule({
      id: 'shipping-fee-tg',
      model: 'PERCENTAGE',
      tenantId: 'acme',
      scope: 'tenant-specific',
      country: 'TG',
      effectiveFrom: '2025-01-01',
      payload: JSON.stringify({
        params: { base: 'orderTotal', rate: 0.05 },
        dominanceGroup: 'shipping',
      }),
      createdBy: 'alice',
    });
    const rules = await new RuleStoreResolver((await makeMockStore([saved])) as never).resolve(
      SHIPPING_NODE,
      SHIPPING_META,
    );
    expect(rules[0]!.dimensions).toEqual({ country: 'TG' });
    expect(rules[0]!['dominanceGroup']).toBe('shipping');

    const engine = new PPEEngine({ plugins: [percentagePlugin()], dsls: [] });
    const result = await engine.evaluate(rules, {
      data: { orderTotal: 200 },
      requestId: 'order-42:shipping',
      meta: { tenantId: 'acme', effectiveDate: new Date('2025-06-01') },
    });

    expect(result.skippedRules).toEqual([]);
    expect(result.appliedRules.map((r) => r.id)).toEqual(['shipping-fee-tg']);
  });

  it('rejects a tampered record with an error naming the rule', async () => {
    const store = await publishedShippingFee();
    tamperPayloads(store);
    const resolver = new RuleStoreResolver(store);

    const error = await resolver.resolve(SHIPPING_NODE, SHIPPING_META).then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(error).toBeInstanceOf(SpecError);
    expect((error as SpecError).code).toBe('INVALID_RULE');
    expect((error as SpecError).message).toContain('shipping-fee@1');
    expect((error as SpecError).message).toContain('checksum mismatch');
  });

  it('fails the node when a stored record is tampered', async () => {
    const store = await publishedShippingFee();
    tamperPayloads(store);
    const engine = new PPEEngine({ plugins: [percentagePlugin()], dsls: [] });
    const orchestrator = new DGOrchestrator(
      new CoreNodeExecutor(engine, new RuleStoreResolver(store)),
      new Map(),
    );
    const graph: DGGraph = {
      id: 'order-fees',
      version: '1.0.0',
      nodes: { shipping: SHIPPING_NODE },
      edges: [],
    };

    const result = await orchestrator.execute(
      new DGCompiler().compile(graph),
      { orderTotal: 200 },
      SHIPPING_META,
    );

    expect(result.status).toBe('failed');
    expect(result.failed).toEqual(['shipping']);
    const failure = result.events.find((e) => e.type === 'node.failed');
    expect(failure).toMatchObject({ nodeId: 'shipping' });
    expect(failure && 'error' in failure ? failure.error : '').toContain('shipping-fee@1');
  });
});
