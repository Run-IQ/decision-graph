# @run-iq/dg

DAG orchestration layer for Run-IQ. Models multi-step evaluation workflows as directed acyclic graphs.

## What it does

Decision Graph turns a JSON graph definition into a compiled, executable pipeline. Each node in the graph runs a calculation (via `@run-iq/core`), fetches external data, or delegates to a nested sub-graph. The orchestrator handles parallelism, failure propagation, merge strategies, and edge conditions.

## Install

```bash
npm install @run-iq/dg
```

Peer dependencies: `@run-iq/core`, `@run-iq/context-engine`

## Quick start

```typescript
import { DGCompiler, DGOrchestrator, CoreNodeExecutor } from '@run-iq/dg';

// 1. Define graph
const graph = {
  id: 'tax-assessment',
  version: '1.0.0',
  nodes: {
    irpp:    { id: 'irpp',    type: 'compute', model: 'PROGRESSIVE_BRACKET', ports: { in: [...], out: [...] }, policy: { onError: 'fail', onFailPropagation: 'halt' } },
    tva:     { id: 'tva',     type: 'compute', model: 'FLAT_RATE',           ports: { in: [...], out: [...] }, policy: { onError: 'fail', onFailPropagation: 'halt' } },
    summary: { id: 'summary', type: 'merge',   ports: { in: [...], out: [...] }, policy: { onError: 'fail', onFailPropagation: 'halt' }, meta: { mergeConfig: { strategy: 'wait-all', onPartialInputs: 'fail' } } },
  },
  edges: [
    { id: 'e1', from: { node: 'irpp', port: 'value' }, to: { node: 'summary', port: 'irpp' } },
    { id: 'e2', from: { node: 'tva',  port: 'value' }, to: { node: 'summary', port: 'tva' } },
  ],
};

// 2. Compile (validates structure, cycles, wiring, policies)
const compiled = new DGCompiler().compile(graph);

// 3. Execute
const executor = new CoreNodeExecutor(ppeEngine, ruleResolver);
const orchestrator = new DGOrchestrator(executor, dslMap);
const result = await orchestrator.execute(compiled, inputData, meta);

// result.outputs → { irpp: 425000, tva: 1800000 }
// result.status  → 'completed' | 'partial' | 'failed'
// result.events  → full audit trail
```

## Node types

| Type | Purpose | Executor |
|---|---|---|
| `compute` | Evaluate rules via PPEEngine | `CoreNodeExecutor` |
| `branch` | Conditional routing | `CoreNodeExecutor` |
| `guard` | Gate execution | `CoreNodeExecutor` |
| `merge` | Aggregate upstream outputs (wait-all, wait-any, wait-quorum) | Built-in |
| `enrich` | Fetch external data via HTTP (read-only) | `HttpNodeExecutor` |
| `subgraph` | Run a nested DG as a single node | `SubGraphExecutor` |

## Key features

**Compiler** (8-step validation pipeline)
- Structure, cycles, topological sort, port wiring, failure propagation, policy checks, hash, DSL variable analysis

**Orchestrator**
- Level-by-level or eager (event-driven) scheduling
- Configurable parallelism limits
- Edge conditions via DSL (JsonLogic, CEL, etc.)
- Lifecycle hooks (beforeGraph, afterGraph, beforeNode, afterNode, onError)

**Executors**
- `CoreNodeExecutor` — delegates to PPEEngine
- `HttpNodeExecutor` — external API calls with retry, timeout, size guard
- `SubGraphExecutor` — nested DG execution with input/output mapping
- `CompositeExecutor` — routes by node type

**Inspector**
- `explainNode` — human-readable node description
- `traceOutput` — trace data flow from any output
- `criticalPath` — identify longest execution path
- `replayUntil` — replay execution up to a specific level
- `toMermaid` / `toGraphviz` — diagram export

**Pipeline**
- `DGPipeline` — DG execution + output layer handlers for post-processing

## Architecture constraints

- Graphs are deterministic: same input = same output, always
- No side-effects inside nodes (enrich is read-only)
- All mutations happen in the output layer, after the DG completes
- Sub-graphs are isolated: child context does not leak into parent

## License

All rights reserved. See LICENSE for details.

---

*Run-IQ implements the PPE specification.*
*github.com/Run-IQ*
