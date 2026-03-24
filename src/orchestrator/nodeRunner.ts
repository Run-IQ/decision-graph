import { roughSizeKb } from '@run-iq/context-engine';
import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { WiringMap } from '../types/ports.js';
import type { NodeExecutor, NodeResult } from '../executor/NodeExecutor.js';
import type { DGContext } from '../context/DGContext.js';
import { DGMissingInputError, DGOutputSizeError } from '../errors.js';
import { now } from '../utils.js';

export function extractInputs(
  node: DGNode,
  wiring: WiringMap,
  ctx: DGContext,
): Record<string, unknown> {
  const inputs: Record<string, unknown> = {};
  const wirings = wiring.get(node.id) ?? [];

  for (const port of node.ports.in) {
    // Try wiring first
    const wire = wirings.find((w) => w.toPort === port.name);
    if (wire) {
      const key =
        wire.fromNode === 'input' ? `input.${wire.fromPort}` : `${wire.fromNode}.${wire.fromPort}`;
      const value = ctx.get(key);

      if (value !== undefined) {
        inputs[wire.aliasedAs ?? port.name] = value;
        continue;
      }
    }

    // Try port default
    if (port.default !== undefined) {
      inputs[port.name] = port.default;
      continue;
    }

    // Required port with no value
    if (port.required) {
      throw new DGMissingInputError(
        `Node "${node.id}": required input port "${port.name}" has no value and no default`,
        node.id,
        port.name,
      );
    }
  }

  return inputs;
}

export function injectOutputs(
  node: DGNode,
  outputs: Readonly<Record<string, unknown>>,
  ctx: DGContext,
): void {
  const maxKb = node.policy.maxOutputSizeKb ?? 512;

  for (const [portName, value] of Object.entries(outputs)) {
    const sizeKb = roughSizeKb(value);
    if (sizeKb > maxKb) {
      throw new DGOutputSizeError(
        `Node "${node.id}" output port "${portName}" is ${sizeKb.toFixed(1)}kb, exceeds maxOutputSizeKb (${maxKb}kb)`,
        node.id,
        sizeKb,
        maxKb,
      );
    }
    ctx.set(node.id, portName, value);
  }
}

export async function runNode(
  node: DGNode,
  wiring: WiringMap,
  ctx: DGContext,
  executor: NodeExecutor,
  meta: ExecutionMeta,
): Promise<NodeResult> {
  const nodeExecutionId = `${meta.requestId}:${node.id}`;
  const inputs = extractInputs(node, wiring, ctx);

  ctx.emit({
    type: 'node.started',
    nodeId: node.id,
    nodeExecutionId,
    inputs,
    ts: now(),
  });

  const result = await executor.execute(node, inputs, meta);

  // Inject outputs into context
  injectOutputs(node, result.outputs, ctx);

  // Store raw if requested
  if (node.policy.storeRaw === true && result.raw !== undefined) {
    const rawSizeKb = roughSizeKb(result.raw);
    ctx.setRaw(node.id, result.raw);
    ctx.emit({
      type: 'node.raw_stored',
      nodeId: node.id,
      sizeKb: rawSizeKb,
      ts: now(),
    });
  }

  ctx.markCompleted(node.id);

  // Emit fallback event if the executor signals it used fallback values
  if (result.usedFallback === true) {
    ctx.emit({
      type: 'node.fallback',
      nodeId: node.id,
      fallback: result.outputs,
      ts: now(),
    });
  }

  ctx.emit({
    type: 'node.completed',
    nodeId: node.id,
    nodeExecutionId,
    outputs: result.outputs,
    durationMs: result.durationMs,
    ts: now(),
  });

  return result;
}
