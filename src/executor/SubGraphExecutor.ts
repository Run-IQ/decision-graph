import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { SubGraphConfig } from '../types/subgraph.js';
import type { CompiledGraph } from '../types/compiled.js';
import type { DGResult } from '../types/result.js';
import type { NodeExecutor, NodeResult } from './NodeExecutor.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Extract a value from a nested object using a dot-separated path. */
function getByDotPath(obj: unknown, path: string): unknown {
  let current: unknown = obj;
  for (const key of path.split('.')) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Function that executes a compiled sub-graph and returns its result.
 *
 * This is intentionally a function — not a DGOrchestrator instance — so the
 * SubGraphExecutor stays decoupled from orchestration internals.  The host
 * wires this up at assembly time.
 */
export type SubGraphRunner = (
  compiled: CompiledGraph,
  input: Record<string, unknown>,
  meta: ExecutionMeta,
) => Promise<DGResult>;

// ─── SubGraphExecutor ─────────────────────────────────────────────────────────

/**
 * Executes `subgraph` nodes by running a full compiled DG as a single node.
 *
 * Each sub-DG:
 * - Is **deterministic** — same inputs always produce the same outputs.
 * - Is **isolated** — its internal context does not leak into the parent.
 * - Has its own executor, rules, and enrich nodes.
 *
 * The parent node receives the sub-DG's outputs via `outputMapping`,
 * plus an audit summary in `raw`.
 *
 * @example
 * ```ts
 * const runner: SubGraphRunner = (compiled, input, meta) =>
 *   orchestrator.execute(compiled, input, meta);
 *
 * const executor = new SubGraphExecutor(
 *   new Map([['DG_FinancialCheck', compiledFinancial]]),
 *   runner,
 * );
 * ```
 */
export class SubGraphExecutor implements NodeExecutor {
  constructor(
    private readonly graphs: ReadonlyMap<string, CompiledGraph>,
    private readonly runner: SubGraphRunner,
  ) {}

  async execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult> {
    if (node.type !== 'subgraph') {
      throw new Error(`SubGraphExecutor: expected node type "subgraph", got "${node.type}"`);
    }

    const cfg = node.meta?.['subGraphConfig'] as SubGraphConfig | undefined;
    if (!cfg) {
      throw new Error(`SubGraphExecutor: node "${node.id}" is missing meta.subGraphConfig`);
    }

    const compiled = this.graphs.get(cfg.graphId);
    if (!compiled) {
      throw new Error(
        `SubGraphExecutor: sub-graph "${cfg.graphId}" not found in registered graphs`,
      );
    }

    // Build sub-DG input from parent context via inputMapping
    const subInput: Record<string, unknown> = {};
    for (const [subKey, parentPath] of Object.entries(cfg.inputMapping)) {
      subInput[subKey] = getByDotPath(inputs, parentPath);
    }

    // Isolate requestId: sub-DG gets a child requestId for tracing
    const childMeta: ExecutionMeta = {
      ...meta,
      requestId: `${meta.requestId}:sg:${node.id}`,
    };

    const start = Date.now();

    // Execute sub-DG
    const result = await this.runner(compiled, subInput, childMeta);

    // Map sub-DG outputs to parent output ports
    const outputs: Record<string, unknown> = {};
    for (const [parentPort, subOutputKey] of Object.entries(cfg.outputMapping)) {
      outputs[parentPort] = result.outputs[subOutputKey];
    }

    return {
      outputs,
      raw: {
        subGraphId: cfg.graphId,
        subGraphHash: result.graphHash,
        subGraphStatus: result.status,
        subGraphRequestId: result.requestId,
        executed: result.executed.length,
        skipped: result.skipped.length,
        failed: result.failed.length,
      },
      durationMs: Date.now() - start,
    };
  }
}
