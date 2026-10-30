# @run-iq/dg

Runs several Run-IQ evaluations as one workflow. You describe the steps as a directed acyclic graph (nodes connected by ports and edges), compile it once, and execute it. Independent nodes run in parallel, and every step is recorded as an event.

A node usually evaluates rules with [`@run-iq/core`](https://github.com/Run-IQ/core). Nodes read and write their values through an `EvaluationContext` from [`@run-iq/context-engine`](https://github.com/Run-IQ/context-engine). Rules can be passed in directly or loaded from a `RuleStore` such as [`@run-iq/rule-registry`](https://github.com/Run-IQ/rule-registry).

## Install

```bash
npm install @run-iq/dg @run-iq/core @run-iq/context-engine
```

`@run-iq/core` and `@run-iq/context-engine` are peer dependencies. Requires Node.js 20 or later.

## Example

Two steps: `shipping` is 5% of the order total, and `insurance` is 10% of the shipping fee.

```ts
import { PPEEngine, computeRuleChecksum } from '@run-iq/core';
import { DGCompiler, DGOrchestrator, CoreNodeExecutor, StaticRuleResolver } from '@run-iq/dg';

// Engine with one calculation model (see @run-iq/core)
const percentage = {
  name: 'PERCENTAGE',
  version: '1.0.0',
  validateParams: (p) => ({ valid: typeof p?.rate === 'number' }),
  calculate: (input, _rule, p) => input[p.base] * p.rate,
};
const engine = new PPEEngine({
  plugins: [{ name: 'demo', version: '1.0.0', onInit: (ctx) => ctx.modelRegistry.register(percentage) }],
  dsls: [],
});

function rule(id, params) {
  const draft = {
    id, version: 1, model: 'PERCENTAGE', params, priority: 1,
    effectiveFrom: new Date('2025-01-01'), effectiveUntil: null, tags: [],
  };
  return { ...draft, checksum: computeRuleChecksum(draft) };
}

const policy = { onError: 'fail', onFailPropagation: 'halt' };

const graph = {
  id: 'order-fees',
  version: '1.0.0',
  nodes: {
    shipping: {
      id: 'shipping', type: 'compute', model: 'PERCENTAGE', policy,
      ports: { in: [{ name: 'orderTotal', required: true }], out: [{ name: 'value', required: true }] },
    },
    insurance: {
      id: 'insurance', type: 'compute', model: 'PERCENTAGE', policy,
      ports: { in: [{ name: 'fee', required: true }], out: [{ name: 'value', required: true }] },
    },
  },
  edges: [
    { id: 'e1', from: { node: 'shipping', port: 'value' }, to: { node: 'insurance', port: 'fee' } },
  ],
};

const resolver = new StaticRuleResolver(new Map([
  ['shipping', [rule('shipping-rate', { base: 'orderTotal', rate: 0.05 })]],
  ['insurance', [rule('insurance-rate', { base: 'fee', rate: 0.1 })]],
]));

const compiled = new DGCompiler().compile(graph);
const orchestrator = new DGOrchestrator(new CoreNodeExecutor(engine, resolver), new Map());

const result = await orchestrator.execute(compiled, { orderTotal: 200 }, {
  requestId: 'order-42',
  tenantId: 'acme',
  timestamp: new Date().toISOString(),
  effectiveDate: '2025-06-01',
});

result.status;   // 'completed'
result.outputs;  // { 'input.orderTotal': 200, 'shipping.value': 10, 'insurance.value': 1 }
result.executed; // ['shipping', 'insurance']
```

## Concepts

- **Ports**: each node declares `in` and `out` ports. Nodes with no incoming edge read their input ports from the execution input. Outputs are stored as `nodeId.port`.
- **Edges** connect an output port to an input port. An edge can have a `condition` evaluated by a DSL (looked up by name in the map passed to `DGOrchestrator`). A node whose incoming edges are all inactive is skipped.
- **Compiler**: `DGCompiler.compile(graph)` checks identifiers, structure, wiring, cycles and policies, sorts nodes into levels and computes a hash of the graph. It throws `DGCompileError` or `DGCycleError` on invalid graphs.
- **Policy**: each node sets `onError` (`'fail'`, `'skip'`, `'fallback'` with `fallback` values) and `onFailPropagation` (`'halt'`, `'skip-descendants'`, `'continue'`). Optional `storeRaw` (keep the raw engine result) and `maxOutputSizeKb` (default 512).
- **Result**: `status` is `'completed'`, `'partial'` or `'failed'`. `events` lists everything that happened, node by node.

## Node types

| Type | Runs with | Notes |
|---|---|---|
| `compute` | `CoreNodeExecutor` | Requires `model`. Output port `value` gets the engine result; `breakdown`, `trace` and `applied` are also available |
| `branch`, `guard` | `CoreNodeExecutor` | Executed like `compute`. Routing is done with edge conditions |
| `merge` | built in | Waits for its parents according to `meta.mergeConfig` (`wait-all`, `wait-any`, `wait-quorum`) |
| `enrich` | `HttpNodeExecutor` | Read-only HTTP call configured in `meta.enrichConfig` |
| `subgraph` | `SubGraphExecutor` | Runs another compiled graph, configured in `meta.subGraphConfig` |

To mix node types, pass a `CompositeExecutor(coreExecutor, httpExecutor, subGraphExecutor?)` to the orchestrator.

## Rule resolvers

`CoreNodeExecutor` asks a resolver for the rules of each node.

- `StaticRuleResolver`: a fixed `Map<nodeId, Rule[]>`.
- `RuleStoreResolver`: queries a `RuleStore` by tenant, node `model` and effective date. The stored `payload` must be JSON of the form `{ params, condition? }`.
- `CachedRuleResolver`, `RetryRuleResolver`, `TimeoutRuleResolver`, `CompositeRuleResolver` wrap other resolvers.

## Orchestrator options

`new DGOrchestrator(executor, dsls, options)`

| Option | Default | |
|---|---|---|
| `scheduling` | `'level'` | `'eager'` starts a node as soon as its parents are done instead of waiting for the whole level |
| `limits` | `maxNodes: 500`, `maxDepth: 50`, `maxEvents: 10000`, `maxDurationMs: 30000`, `maxParallelNodes: 20` | |
| `logLevel` | `'standard'` | `'minimal'` or `'verbose'` to record fewer or more events |
| `hooks` | none | `beforeGraph`, `beforeNode`, `afterNode`, `afterGraph`, `onError` |
| `adapter` | none | A `PersistenceAdapter`; its `executions` store records each run |
| `streaming` | none | An `EventEmitter` that receives each event as `'dg:event'` |

## Inspecting a run

`new DGInspector(graph, result)` explains a node, traces where an output came from, computes the critical path, replays the run up to a given point, and exports the graph with `toMermaid()`, `toGraphviz()` or `toVisualizationData()`.

## Side effects

Nodes are meant to be free of side effects. Work such as sending emails or storing documents goes in `DGPipeline`, which runs the graph and then calls a list of `OutputLayerHandler`s with the result.

## License

Business Source License 1.1. Production use is allowed, except offering the package as a hosted or embedded service that competes with the licensor. It converts to Apache 2.0 on 2030-01-01. See [LICENSE](LICENSE).
