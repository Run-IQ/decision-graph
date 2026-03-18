# @run-iq/dg — Architecture

## Overview

The Decision Graph (DG) is a DAG orchestration layer for Run-IQ.
It models multi-step parametric workflows as directed acyclic graphs
where each node calls the Core PPEEngine, edges carry data
dependencies, and DGContext is the shared data vector.

The DG does **not** know any domain logic. It orchestrates — it does
not calculate.

---

## Core Invariant

> Every node in a DG graph is **deterministic and side-effect free**.
>
> Same inputs + same rules = same outputs. Always.

This invariant enables: replay, audit, caching, snapshot
reproducibility, and formal verification of graph behavior.

---

## Node Types (closed set)

```
compute  — calls PPEEngine.evaluate() with resolved rules
branch   — conditional routing (no execution, just edge selection)
guard    — blocks execution if condition is false
merge    — aggregates outputs from multiple parents
```

These four types are defined in `DGNodeType` (src/types/graph.ts).
The set is **intentionally closed**. Adding a new type requires
modifying the type definition, the compiler (9 validation steps),
and the orchestrator — this is by design to prevent accidental
extension.

---

## What the DG is NOT

The DG is **not** a general-purpose workflow engine (BPMN, Temporal,
Airflow). It does not:

- Make HTTP calls
- Query databases
- Call external services
- Perform I/O of any kind

All data enters the graph via the `input` parameter at execution
time. All rules are resolved locally via `RuleResolver`.

---

## External Data Strategy

### Current state

All nodes execute locally via `CoreNodeExecutor` which calls
`PPEEngine.evaluate()`. No network, no I/O, no non-determinism.

### Future extension path

When the need arises for external data (API enrichment, ML scoring,
external validation), the extension point is:

```
NodeExecutor (interface)
├── CoreNodeExecutor      — local PPEEngine (exists today)
├── HttpNodeExecutor      — external APIs (future)
└── CompositeExecutor     — routing by node type (future)
```

The `NodeExecutor` interface is already the right abstraction.
A new executor can be injected without changing the DG core.

### When to introduce external nodes

Introduce external data nodes **only when all of these are true**:

1. A real business requirement exists (not speculative)
2. The alternative (pre-processing data before graph execution) is
   proven insufficient
3. The schema for external nodes is fully designed and reviewed
4. Timeout, retry, fallback, and failure policies are mandatory
   (not optional) in the schema

### Constraints for future external nodes (non-negotiable)

When external nodes are introduced, they **must**:

- Be a **new node type** (e.g., `'enrich'`) — never hidden inside
  `compute` nodes
- Have **mandatory timeout** — no unbounded network calls
- Have **mandatory onFailure policy** — fail / skip / fallback
- Have **explicit input/output mapping** — no raw response injection
  into context
- Have **no side effects** — read-only external calls only
- Be **auditable** — every external call logged in the event trail
- Be **opt-in per graph** — not enabled by default

### What is explicitly forbidden

- `fetch()`, `http`, or any I/O inside `CoreNodeExecutor`
- Network calls inside `PPEEngine.evaluate()` or rule resolvers
- Passing arbitrary functions or closures through node `meta`
- External calls in `branch` or `guard` nodes (must stay pure)

Violation of these rules breaks the determinism invariant and makes
replay, audit, and caching unreliable.

---

## Extension Points

| Point | Interface | Purpose |
|-------|-----------|---------|
| Node execution | `NodeExecutor` | How nodes run (PPE today, HTTP future) |
| Rule resolution | `RuleResolver` | Where rules come from (store, cache, static) |
| DSL evaluation | `DSLEvaluator` | How edge conditions are evaluated |
| Persistence | `PersistenceAdapter` | Where execution state is stored |
| Lifecycle | `DGLifecycleHooks` | Before/after graph/node hooks |
| Scheduling | `DGOrchestratorOptions.scheduling` | `'level'` or `'eager'` |

All extensions are injected at construction time. The DG has zero
global state and zero singletons.
