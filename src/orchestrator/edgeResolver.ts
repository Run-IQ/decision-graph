import type { DSLEvaluator } from '@run-iq/core';
import type { CompiledGraph } from '../types/compiled.js';
import type { DGContext } from '../context/DGContext.js';
import { now } from '../utils.js';

/**
 * Given a list of candidate node IDs for a level, resolve which ones
 * are actually active based on their incoming edge conditions.
 *
 * A node is active if:
 * - It has no incoming edges (root node) → always active
 * - ALL incoming edges with conditions evaluate to true
 * - At least one incoming edge exists without a condition (unconditional)
 *
 * If an edge condition evaluates to false, the edge is marked inactive.
 * If ALL incoming edges for a node are inactive, the node is skipped.
 */
export function resolveActiveNodes(
  nodeIds: readonly string[],
  compiled: CompiledGraph,
  ctx: DGContext,
  dsls: Map<string, DSLEvaluator>,
): { active: string[]; skipped: string[] } {
  const active: string[] = [];
  const skipped: string[] = [];

  for (const nodeId of nodeIds) {
    // Find all incoming edges for this node
    const incomingEdges = compiled.source.edges.filter((e) => e.to.node === nodeId);

    // Root nodes (no incoming edges) are always active
    if (incomingEdges.length === 0) {
      active.push(nodeId);
      continue;
    }

    // Check if the node has at least one active incoming edge
    let hasActiveEdge = false;

    for (const edge of incomingEdges) {
      // Skip edges from skipped/failed parents
      if (ctx.isSkipped(edge.from.node) || ctx.isFailed(edge.from.node)) {
        ctx.emit({
          type: 'edge.inactive',
          edgeId: edge.id,
          scope: 'parent-unavailable',
          evaluated: null,
          ts: now(),
        });
        continue;
      }

      // If no condition, edge is unconditionally active
      if (!edge.condition) {
        hasActiveEdge = true;
        continue;
      }

      // Evaluate the condition
      const dsl = dsls.get(edge.condition.dsl);
      if (!dsl) {
        // DSL not found → treat edge as inactive
        ctx.emit({
          type: 'edge.inactive',
          edgeId: edge.id,
          scope: edge.condition.scope,
          evaluated: `DSL "${edge.condition.dsl}" not found`,
          ts: now(),
        });
        continue;
      }

      // Build evaluation context based on scope
      let evalContext: Record<string, unknown>;
      if (edge.condition.scope === 'source-output') {
        evalContext = ctx.getNodeOutputs(edge.from.node);
      } else {
        // full-context
        evalContext = ctx.getFullState() as Record<string, unknown>;
      }

      const result = dsl.evaluate(edge.condition.expression, evalContext);

      if (result) {
        hasActiveEdge = true;
      } else {
        ctx.emit({
          type: 'edge.inactive',
          edgeId: edge.id,
          scope: edge.condition.scope,
          evaluated: result,
          ts: now(),
        });
      }
    }

    if (hasActiveEdge) {
      active.push(nodeId);
    } else {
      skipped.push(nodeId);
    }
  }

  return { active, skipped };
}
