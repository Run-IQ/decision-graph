/**
 * Configuration for `subgraph` nodes — nested deterministic DG execution.
 *
 * A subgraph node runs a full pre-compiled DG as a single node in the
 * parent graph.  This enables modular, hierarchical graph composition
 * where each sub-DG is independently testable, deterministic, and
 * domain-scoped.
 *
 * The sub-DG receives mapped inputs from the parent context and its
 * outputs are mapped back to the parent node's output ports.
 */
export interface SubGraphConfig {
  /**
   * Identifier of the pre-registered compiled sub-graph.
   * Must match a key in `SubGraphExecutor.graphs`.
   */
  readonly graphId: string;

  /**
   * Maps parent context paths to sub-DG input keys.
   * Example: `{ "companyNif": "enterprise.nif" }`
   * → the sub-DG receives `{ companyNif: <value at enterprise.nif> }`.
   */
  readonly inputMapping: Readonly<Record<string, string>>;

  /**
   * Maps sub-DG output keys to parent output port names.
   * Example: `{ "financialScore": "score", "liquidityIndex": "liquidity" }`
   * → parent ports `financialScore` and `liquidityIndex` receive the
   *   sub-DG's `score` and `liquidity` outputs.
   */
  readonly outputMapping: Readonly<Record<string, string>>;
}
