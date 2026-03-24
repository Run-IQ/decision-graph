import type { ExecutionMeta } from '@run-iq/context-engine';
import type { DGNode } from '../types/graph.js';
import type { EnrichConfig } from '../types/enrich.js';
import { ENRICH_DEFAULTS } from '../types/enrich.js';
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

/** Build a URL with query-string params from inputMapping. */
function buildGetUrl(
  endpoint: string,
  mapping: Readonly<Record<string, string>>,
  inputs: Readonly<Record<string, unknown>>,
): string {
  const url = new URL(endpoint);
  for (const [paramName, contextPath] of Object.entries(mapping)) {
    const value = getByDotPath(inputs, contextPath);
    if (value !== undefined && value !== null) {
      url.searchParams.set(paramName, String(value));
    }
  }
  return url.toString();
}

/** Build a JSON body from inputMapping. */
function buildPostBody(
  mapping: Readonly<Record<string, string>>,
  inputs: Readonly<Record<string, unknown>>,
): string {
  const body: Record<string, unknown> = {};
  for (const [fieldName, contextPath] of Object.entries(mapping)) {
    body[fieldName] = getByDotPath(inputs, contextPath);
  }
  return JSON.stringify(body);
}

/** Sleep for exponential backoff: min(100 * 2^attempt, 2000) ms. */
function backoff(attempt: number): Promise<void> {
  const ms = Math.min(100 * 2 ** attempt, 2000);
  return new Promise((r) => setTimeout(r, ms));
}

// ─── HttpNodeExecutor ─────────────────────────────────────────────────────────

/**
 * Executes `enrich` nodes by fetching external data via HTTP.
 *
 * **Read-only** — GET or POST (for legacy/SOAP/GraphQL read queries).
 * No side-effects. No credentials stored in the graph.
 *
 * Headers are injected at runtime via `meta.context?.['__enrichHeaders']`.
 * This keeps the graph definition free of secrets.
 *
 * @example
 * ```ts
 * const executor = new HttpNodeExecutor();
 * // or with custom fetch for testing:
 * const executor = new HttpNodeExecutor(mockFetch);
 * ```
 */
export class HttpNodeExecutor implements NodeExecutor {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(fetchFn?: typeof globalThis.fetch) {
    this.fetchFn = fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  async execute(
    node: DGNode,
    inputs: Readonly<Record<string, unknown>>,
    meta: ExecutionMeta,
  ): Promise<NodeResult> {
    if (node.type !== 'enrich') {
      throw new Error(`HttpNodeExecutor: expected node type "enrich", got "${node.type}"`);
    }

    const cfg = node.meta?.['enrichConfig'] as EnrichConfig | undefined;
    if (!cfg) {
      throw new Error(`HttpNodeExecutor: node "${node.id}" is missing meta.enrichConfig`);
    }

    const method = cfg.method ?? ENRICH_DEFAULTS.method;
    const maxRetries = cfg.retry ?? ENRICH_DEFAULTS.retry;
    const maxBytes = cfg.responseMaxBytes ?? ENRICH_DEFAULTS.responseMaxBytes;

    // Injected headers — never from graph definition
    const injectedHeaders =
      (meta.context?.['__enrichHeaders'] as Record<string, string> | undefined) ?? {};

    const start = Date.now();
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) await backoff(attempt - 1);

      try {
        const result = await this.attemptFetch(
          node,
          cfg,
          method,
          inputs,
          injectedHeaders,
          maxBytes,
        );
        return { ...result, durationMs: Date.now() - start };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Only retry on network errors and 5xx — not 4xx
        if (lastError.message.startsWith('HTTP 4')) break;
      }
    }

    // All retries exhausted
    if (cfg.onFailure === 'fallback' && node.policy.fallback) {
      return {
        outputs: { ...node.policy.fallback },
        raw: { error: lastError?.message, retries: maxRetries },
        durationMs: Date.now() - start,
        usedFallback: true,
      };
    }

    throw lastError ?? new Error(`HttpNodeExecutor: fetch failed for node "${node.id}"`);
  }

  private async attemptFetch(
    node: DGNode,
    cfg: EnrichConfig,
    method: 'GET' | 'POST',
    inputs: Readonly<Record<string, unknown>>,
    injectedHeaders: Record<string, string>,
    maxBytes: number,
  ): Promise<Omit<NodeResult, 'durationMs'>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const url =
        method === 'GET' ? buildGetUrl(cfg.endpoint, cfg.inputMapping, inputs) : cfg.endpoint;

      const headers: Record<string, string> = { ...injectedHeaders };

      const fetchInit: RequestInit = {
        method,
        headers,
        signal: controller.signal,
      };

      if (method === 'POST') {
        headers['Content-Type'] = 'application/json';
        fetchInit.body = buildPostBody(cfg.inputMapping, inputs);
      }

      const response = await this.fetchFn(url, fetchInit);

      if (response.status >= 400 && response.status < 500) {
        throw new Error(`HTTP ${response.status}: client error for node "${node.id}"`);
      }
      if (response.status >= 500) {
        throw new Error(`HTTP ${response.status}: server error for node "${node.id}" (retryable)`);
      }

      const text = await response.text();

      if (text.length > maxBytes) {
        throw new Error(
          `Response for node "${node.id}" exceeds max size: ${text.length} > ${maxBytes} bytes`,
        );
      }

      const json: unknown = JSON.parse(text);

      // Map response to output ports
      const outputs: Record<string, unknown> = {};
      for (const [portName, responsePath] of Object.entries(cfg.outputMapping)) {
        outputs[portName] = getByDotPath(json, responsePath);
      }

      return {
        outputs,
        raw: {
          request: { url, method },
          response: { statusCode: response.status, sizeBytes: text.length },
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
