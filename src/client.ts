import { TIMEOUT_MS, BILLING_URL } from "./constants.js";
import type { HttpMethod, SocialCrawlResponse } from "./types.js";

export interface ClientConfig {
  /** The user's SocialCrawl API key (`sc_…`). */
  apiKey: string;
  /** Base origin, e.g. https://www.socialcrawl.dev. No trailing slash. */
  baseUrl: string;
}

export interface ApiCallOptions {
  /** Platform slug, e.g. "tiktok". Use "meta" for top-level paths like credits/balance. */
  platform: string;
  /**
   * Resource path, e.g. "profile", "profile/videos", or a path template like
   * "jobs/{job_id}". `{token}` placeholders are filled from `params` (and those
   * keys are then removed from the query string / JSON body).
   */
  resource: string;
  /** HTTP method. Defaults to GET. The stateful web routes also use POST/PATCH/DELETE. */
  method?: HttpMethod;
  /**
   * Request parameters, forwarded verbatim. GET/DELETE send them as the query
   * string (coerced to strings); POST/PATCH send them as a JSON body (types
   * preserved). Values used to fill `{token}` path placeholders are consumed.
   */
  params?: Record<string, unknown>;
  /**
   * Optional `Idempotency-Key` header (BIL-02). Pass an opaque client-generated
   * string (UUIDv4 recommended) to make retries safe: the first response is stored
   * server-side for 24h; replays return the original body and deduct 0 new credits.
   */
  idempotencyKey?: string;
}

export interface ApiCallResult {
  ok: boolean;
  status: number;
  /** The resolved public path that was called, e.g. "/v1/web/jobs/job_abc". */
  path: string;
  /** Raw response text. */
  raw: string;
  /** Parsed JSON envelope, or null if the body was not JSON. */
  json: SocialCrawlResponse | null;
  /** Human-readable error message when `ok` is false. */
  errorMessage?: string;
}

const BODY_METHODS = new Set<HttpMethod>(["POST", "PATCH"]);

/**
 * Makes a single call to the SocialCrawl API and returns a structured result.
 * The auth model is a simple `x-api-key` header — no OAuth, no token refresh.
 * The public path is `{METHOD} {baseUrl}/v1/{platform}/{resource}` (or
 * `/v1/{resource}` when platform === "meta"), with any `{token}` placeholders
 * in `resource` substituted from `params`.
 */
export async function callApi(
  config: ClientConfig,
  options: ApiCallOptions,
): Promise<ApiCallResult> {
  const method: HttpMethod = options.method ?? "GET";
  const { path, consumed } = resolvePath(options.platform, options.resource, options.params);
  const rest = omit(options.params ?? {}, consumed);

  const useBody = BODY_METHODS.has(method);
  let url = `${config.baseUrl}${path}`;
  if (!useBody) {
    const query = toQueryString(rest);
    if (query) url += `?${query}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = { "x-api-key": config.apiKey };
  if (options.idempotencyKey) {
    headers["Idempotency-Key"] = options.idempotencyKey;
  }
  let body: string | undefined;
  if (useBody && Object.keys(rest).length > 0) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(rest);
  }

  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    });

    // 204 No Content (e.g. DELETE) has an empty body — report success explicitly.
    if (response.status === 204) {
      return {
        ok: true,
        status: 204,
        path,
        raw: "",
        json: { success: true, status: 204 } as unknown as SocialCrawlResponse,
      };
    }

    const raw = await response.text();
    let json: SocialCrawlResponse | null = null;
    try {
      json = JSON.parse(raw) as SocialCrawlResponse;
    } catch {
      // Non-JSON body — leave json as null.
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        path,
        raw,
        json,
        errorMessage: formatHttpError(response.status, json, options),
      };
    }

    return { ok: true, status: response.status, path, raw, json };
  } catch (error: unknown) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return {
        ok: false,
        status: 0,
        path,
        raw: "",
        json: null,
        errorMessage: `Request timed out after ${TIMEOUT_MS / 1000}s. The platform may be experiencing delays — try again.`,
      };
    }
    return {
      ok: false,
      status: 0,
      path,
      raw: "",
      json: null,
      errorMessage: `Network error reaching the SocialCrawl API at ${config.baseUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolves a resource path: substitutes `{token}` placeholders from params and
 * returns the public path plus the list of param keys consumed by the path.
 */
export function resolvePath(
  platform: string,
  resource: string,
  params?: Record<string, unknown>,
): { path: string; consumed: string[] } {
  const consumed: string[] = [];
  const resolvedResource = resource.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    consumed.push(name);
    const value = params?.[name];
    return encodeURIComponent(value == null ? "" : String(value));
  });
  const path =
    platform === "meta"
      ? `/v1/${resolvedResource}`
      : `/v1/${platform}/${resolvedResource}`;
  return { path, consumed };
}

/** Full URL for a GET/DELETE call (query-string transport). Kept for tests. */
export function buildUrl(baseUrl: string, options: ApiCallOptions): string {
  const { path, consumed } = resolvePath(options.platform, options.resource, options.params);
  const rest = omit(options.params ?? {}, consumed);
  const query = toQueryString(rest);
  return query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;
}

/** Coerce a params object into a URL-encoded query string, dropping empties. */
function toQueryString(params: Record<string, unknown>): string {
  const pairs: [string, string][] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    pairs.push([key, typeof value === "string" ? value : String(value)]);
  }
  return new URLSearchParams(pairs).toString();
}

function omit(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  if (keys.length === 0) return { ...obj };
  const drop = new Set(keys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!drop.has(k)) out[k] = v;
  }
  return out;
}

interface ParsedErrorEnvelope {
  error?: { type?: string; message?: string; doc_url?: string };
  credits_remaining?: number;
}

export function formatHttpError(
  status: number,
  json: SocialCrawlResponse | null,
  options: ApiCallOptions,
): string {
  const parsed = json as ParsedErrorEnvelope | null;
  const errorType = parsed?.error?.type ?? "UNKNOWN_ERROR";
  const errorMessage = parsed?.error?.message ?? `HTTP ${status}`;
  const docUrl = parsed?.error?.doc_url;

  switch (status) {
    case 401:
      return "Invalid API key. Double-check the `apiKey` input — it should look like `sc_…`. Get a free key at socialcrawl.dev.";
    case 402:
      return `Insufficient credits (${parsed?.credits_remaining ?? 0} remaining). Top up at ${BILLING_URL}.`;
    case 400:
      return `Bad request: ${errorMessage}`;
    case 404:
      if (errorType === "RESOURCE_NOT_FOUND") {
        return `Resource not found upstream — the requested ${options.platform} resource doesn't exist. Credits were refunded automatically.`;
      }
      return `Endpoint /v1/${options.platform}/${options.resource} not found. Use action "List endpoints" to see what's available for ${options.platform}.`;
    case 405:
      return `Method not allowed for /v1/${options.platform}/${options.resource}. Set the "method" input to the verb this resource supports (see action "List endpoints").`;
    case 409:
      return "Idempotency-Key conflict — that key was already used by another account. Generate a fresh UUIDv4.";
    case 422:
      return "Idempotency-Key payload mismatch — you reused a key with different parameters. Use a new key, or repeat the request exactly.";
    case 429:
      return "Too many concurrent requests on this API key (50 max). Wait a moment and retry.";
    case 502:
      return "Upstream error fetching data. Credits were auto-refunded — retry shortly.";
    case 503:
      return `Platform ${options.platform} is temporarily unavailable. Credits were auto-refunded — retry in ~30s.`;
    default: {
      const docHint = docUrl ? ` See ${docUrl}` : "";
      return `Error ${status}: ${errorType} — ${errorMessage}${docHint}`;
    }
  }
}
