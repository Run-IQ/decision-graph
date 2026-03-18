import type { DGResult } from '../types/result.js';

/**
 * Context passed to output layer handlers after DG execution.
 */
export interface OutputLayerContext {
  readonly requestId: string;
  readonly tenantId: string;
  readonly timestamp: string;
  readonly meta?: Readonly<Record<string, unknown>>;
}

/**
 * Single post-processing handler.
 *
 * Output layer handlers execute **after** the DG completes.
 * They handle side-effects that must NEVER live inside a graph:
 * PDF generation, email notifications, database archival, logging.
 *
 * Handlers run sequentially in registration order.  If a handler
 * throws, the pipeline records the error and continues to the
 * next handler (unless `abortOnError` is set on the pipeline).
 */
export interface OutputLayerHandler {
  /** Human-readable handler name for audit trail. */
  readonly name: string;

  /** Return true if this handler should run for the given result. */
  canHandle(result: DGResult): boolean;

  /** Execute the side-effect. */
  handle(result: DGResult, context: OutputLayerContext): Promise<void>;
}

/**
 * Result of a single output layer handler execution.
 */
export interface OutputHandlerResult {
  readonly name: string;
  readonly executed: boolean;
  readonly durationMs: number;
  readonly error?: string;
}
