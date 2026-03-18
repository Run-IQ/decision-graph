import type { ExecutionMeta } from '@run-iq/context-engine';
import type { CompiledGraph } from '../types/compiled.js';
import type { DGResult } from '../types/result.js';
import type { DGOrchestrator } from '../orchestrator/DGOrchestrator.js';
import type { OutputLayerHandler, OutputLayerContext, OutputHandlerResult } from './OutputLayer.js';

/**
 * Full pipeline result: DG execution + output layer handler results.
 */
export interface PipelineResult {
  readonly dgResult: DGResult;
  readonly handlers: readonly OutputHandlerResult[];
  readonly totalDurationMs: number;
}

/**
 * Pipeline options.
 */
export interface DGPipelineOptions {
  /**
   * If true, stop executing handlers on the first error.
   * Default: false (continue to next handler).
   */
  readonly abortOnError?: boolean;
}

/**
 * Orchestrates DG execution followed by an output layer.
 *
 * The DG is deterministic and side-effect free.
 * All side-effects (PDF, email, archival, notifications) live
 * in the output layer handlers, which run sequentially after
 * the DG completes.
 *
 * @example
 * ```ts
 * const pipeline = new DGPipeline(orchestrator, [
 *   new PdfReportHandler(),
 *   new EmailNotifier(),
 *   new AuditArchiver(),
 * ]);
 *
 * const result = await pipeline.run(compiledGraph, input, meta);
 * // result.dgResult — the DG outputs
 * // result.handlers — which handlers ran and their status
 * ```
 */
export class DGPipeline {
  private readonly orchestrator: DGOrchestrator;
  private readonly handlers: readonly OutputLayerHandler[];
  private readonly options: DGPipelineOptions;

  constructor(
    orchestrator: DGOrchestrator,
    handlers: readonly OutputLayerHandler[],
    options?: DGPipelineOptions,
  ) {
    this.orchestrator = orchestrator;
    this.handlers = handlers;
    this.options = options ?? {};
  }

  async run(
    compiled: CompiledGraph,
    input: Record<string, unknown>,
    meta: ExecutionMeta,
  ): Promise<PipelineResult> {
    const pipelineStart = Date.now();

    // 1. Execute the DG (deterministic, no side-effects)
    const dgResult = await this.orchestrator.execute(compiled, input, meta);

    // 2. Run output layer handlers (side-effects)
    const handlerContext: OutputLayerContext = {
      requestId: meta.requestId,
      tenantId: meta.tenantId,
      timestamp: new Date().toISOString(),
      ...(meta.context !== undefined ? { meta: meta.context } : {}),
    };

    const handlerResults: OutputHandlerResult[] = [];

    for (const handler of this.handlers) {
      const handlerStart = Date.now();

      if (!handler.canHandle(dgResult)) {
        handlerResults.push({
          name: handler.name,
          executed: false,
          durationMs: 0,
        });
        continue;
      }

      try {
        await handler.handle(dgResult, handlerContext);
        handlerResults.push({
          name: handler.name,
          executed: true,
          durationMs: Date.now() - handlerStart,
        });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        handlerResults.push({
          name: handler.name,
          executed: true,
          durationMs: Date.now() - handlerStart,
          error,
        });

        if (this.options.abortOnError) break;
      }
    }

    return {
      dgResult,
      handlers: handlerResults,
      totalDurationMs: Date.now() - pipelineStart,
    };
  }
}
