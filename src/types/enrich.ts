/**
 * Configuration for `enrich` nodes — external read-only data fetching.
 *
 * Enrich nodes fetch data from external APIs to feed into downstream
 * compute nodes.  They are strictly read-only: no side-effects, no
 * mutations on external systems.
 *
 * Credentials (Authorization, API keys) are NEVER stored in the graph.
 * They are injected at runtime via `meta.context['__enrichHeaders']`.
 */
export interface EnrichConfig {
  /** Target URL. May contain path parameters but no credentials. */
  readonly endpoint: string;

  /** HTTP method — GET or POST (for legacy/SOAP/GraphQL read queries). */
  readonly method?: 'GET' | 'POST';

  /** Per-attempt timeout in milliseconds. Required. Max 5000. */
  readonly timeoutMs: number;

  /** Number of retries on 5xx / network error. 0–3. Default 0. */
  readonly retry?: number;

  /**
   * What to do when the HTTP call fails after all retries.
   * - `'fail'`     — throw (let NodePolicy.onError handle it)
   * - `'fallback'` — return `node.policy.fallback` as outputs
   */
  readonly onFailure: 'fail' | 'fallback';

  /**
   * Maps context/input paths to request parameters.
   * - GET:  values become query-string params (`?key=value`)
   * - POST: values become JSON body fields (`{ key: value }`)
   */
  readonly inputMapping: Readonly<Record<string, string>>;

  /**
   * Maps dot-paths in the JSON response to output port names.
   * Example: `{ "creditScore": "data.score" }` extracts
   * `response.data.score` into the `creditScore` output port.
   */
  readonly outputMapping: Readonly<Record<string, string>>;

  /** Max response body size in bytes. Default 102400 (100 KB). */
  readonly responseMaxBytes?: number;
}

export const ENRICH_DEFAULTS = {
  method: 'GET' as const,
  retry: 0,
  responseMaxBytes: 102_400,
} as const;
