import { vi } from 'vitest';
import type { NodeExecutor, NodeResult } from '../../src/executor/NodeExecutor.js';
import type { DGNode } from '../../src/types/graph.js';
import type { ExecutionMeta } from '@run-iq/context-engine';

/**
 * Creates a mock executor that returns fixed outputs.
 */
export function mockExecutor(outputs: Record<string, unknown> = { v: 42 }): NodeExecutor {
  return {
    execute: vi.fn().mockResolvedValue({ outputs, durationMs: 1 }),
  };
}

/**
 * Creates an executor that fails with given message.
 */
export function failingExecutor(msg = 'boom'): NodeExecutor {
  return {
    execute: vi.fn().mockRejectedValue(new Error(msg)),
  };
}

/**
 * Creates an executor whose output depends on the node ID.
 */
export function dynamicExecutor(
  fn: (node: DGNode, inputs: Record<string, unknown>, meta: ExecutionMeta) => NodeResult,
): NodeExecutor {
  return {
    execute: vi
      .fn()
      .mockImplementation((node: DGNode, inputs: Record<string, unknown>, meta: ExecutionMeta) =>
        Promise.resolve(fn(node, inputs, meta)),
      ),
  };
}

/**
 * Creates an executor that transforms inputs.
 */
export function transformExecutor(
  transform: (inputs: Record<string, unknown>) => Record<string, unknown>,
): NodeExecutor {
  return {
    execute: vi
      .fn()
      .mockImplementation((_node: DGNode, inputs: Record<string, unknown>) =>
        Promise.resolve({ outputs: transform(inputs), durationMs: 1 }),
      ),
  };
}
