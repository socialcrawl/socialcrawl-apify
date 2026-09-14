import { ACTOR_NAME, ACTOR_VERSION, TIMEOUT_MS, BILLING_URL } from "./constants.js";
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
  /**
   * Full public path template, overriding `/v1/{platform}/{resource}`. Used by
   * the non-registry stateful families whose route does not follow that shape —
   * `monitors/pause` is `PATCH /v1/monitors/{monitor_id}`, not
   * `/v1/monitors/pause`. `{token}` placeholders are substituted the same way.
   */
  path?: string;
  /** HTTP method. Defaults to GET. The stateful routes also use POST/PUT/PATCH/DELETE. */
  method?: HttpMethod;
  /**
   * Request parameters, forwarded verbatim. GET/DELETE send them as the query
   * string (coerced to strings); POST/PUT/PATCH send them as a JSON body (types
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

const BODY_METHODS = new Set<HttpMethod>(["POST", "PUT", "PATCH"]);

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
  const { path, consumed } = resolvePath(
    options.platform,
    options.resource,
    options.params,
    options.path,
  );
  const rest = omit(options.params ?? {}, consumed);

  const useBody = BODY_METHODS.has(method);
  let url = `${config.baseUrl}${path}`;
  if (!useBody) {
    const query = toQueryString(rest);
    if (query) url += `?${query}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers: Record<string, string> = {
    "x-api-key": config.apiKey,
    // Identifies Actor traffic to the API, so a support question about a
    // request can be tied to the Actor build that made it.
    "User-Agent": `${ACTOR_NAME}/${ACTOR_VERSION}`,
  };
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
      // `?.` so a fetch-like response without headers still reports the API
      // error rather than throwing into the network-error branch below.
      const headerRequestId = response.headers?.get("x-request-id");
      return {
        ok: false,
        status: response.status,
        path,
        raw,
        json,
        errorMessage: formatHttpError(response.status, json, options, headerRequestId),
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
  pathTemplate?: string,
): { path: string; consumed: string[] } {
  const consumed: string[] = [];
  const template =
    pathTemplate ??
    (platform === "meta" ? `/v1/${resource}` : `/v1/${platform}/${resource}`);
  // Each `{token}` is a required param of the endpoint, so a missing value is
  // already a validation failure by the time we get here. encodeURIComponent is
  // what keeps a hostile id from steering the request at another /v1 route.
  const path = template.replace(/\{([^}]+)\}/g, (_match, name: string) => {
    consumed.push(name);
    const value = params?.[name];
    return encodeURIComponent(value == null ? "" : String(value));
  });
  return { path, consumed };
}

/** Full URL for a GET/DELETE call (query-string transport). Kept for tests. */
export function buildUrl(baseUrl: string, options: ApiCallOptions): string {
  const { path, consumed } = resolvePath(
    options.platform,
    options.resource,
    options.params,
    options.path,
  );
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
  error?: {
    type?: string;
    message?: string;
    doc_url?: string;
    details?: { reason?: unknown };
  };
  credits_remaining?: number;
  request_id?: unknown;
}

/**
 * Maps a non-2xx response to the run's error message. The server's own
 * `error.message` is always passed through (a fixed lead-in only names the
 * category), and `details.reason` plus the `request_id` (from the body, else the
 * `X-Request-Id` header) are appended in one trailing clause: the request id is
 * what support needs to find the call, and dropping it left customers with
 * nothing to quote.
 */
export function formatHttpError(
  status: number,
  json: SocialCrawlResponse | null,
  options: ApiCallOptions,
  headerRequestId?: string | null,
): string {
  const parsed = json && typeof json === "object" ? (json as ParsedErrorEnvelope) : null;
  const requestId = nonEmptyString(parsed?.request_id) ?? nonEmptyString(headerRequestId);
  const reason = nonEmptyString(parsed?.error?.details?.reason);

  const context: string[] = [];
  if (reason) context.push(`reason: ${reason}`);
  if (requestId) context.push(`request_id: ${requestId}`);
  const main = describeHttpError(status, parsed, options);
  return context.length > 0 ? `${main} (${context.join(", ")})` : main;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Ends a server message with punctuation so a following sentence reads cleanly. */
function sentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function describeHttpError(
  status: number,
  parsed: ParsedErrorEnvelope | null,
  options: ApiCallOptions,
): string {
  const errorType = parsed?.error?.type ?? "UNKNOWN_ERROR";
  const serverMessage = nonEmptyString(parsed?.error?.message);
  const errorMessage = serverMessage ?? `HTTP ${status}`;
  const docUrl = parsed?.error?.doc_url;
  // The server's message as a leading sentence, or nothing when it sent none.
  const said = serverMessage ? `${sentence(serverMessage)} ` : "";

  switch (status) {
    case 401:
      return `Invalid API key. ${said}Double-check the \`apiKey\` input: it should look like \`sc_…\`. Get a free key at socialcrawl.dev.`;
    case 402:
      // A spent per-key cap needs the cap raised; topping up would not clear it.
      if (errorType === "KEY_BUDGET_EXCEEDED") {
        return serverMessage ?? "This API key has spent its per-key credit limit. Raise the key's limit in the dashboard; topping up will not clear it.";
      }
      return `Insufficient credits (${parsed?.credits_remaining ?? 0} remaining). ${said}Top up at ${BILLING_URL}.`;
    case 400:
      return `Bad request: ${errorMessage}`;
    case 404:
      if (errorType === "RESOURCE_NOT_FOUND") {
        return serverMessage
          ? `Resource not found (${options.platform}). ${serverMessage}`
          : `Resource not found upstream: the requested ${options.platform} resource doesn't exist. Credits were refunded automatically.`;
      }
      return `Endpoint /v1/${options.platform}/${options.resource} not found. ${said}Use action "List endpoints" to see what's available for ${options.platform}.`;
    case 405:
      return `Method not allowed for /v1/${options.platform}/${options.resource}. ${said}Set the "method" input to the verb this resource supports (see action "List endpoints").`;
    // 409 and 422 are the idempotency codes, but the cohort family reuses them
    // for its own conflicts; only blame the key when the envelope says so.
    case 409:
      if (errorType === "IDEMPOTENCY_KEY_CONFLICT" || errorType === "UNKNOWN_ERROR") {
        return serverMessage
          ? `Idempotency-Key conflict. ${said}Generate a fresh UUIDv4.`
          : "Idempotency-Key conflict: that key was already used by another account. Generate a fresh UUIDv4.";
      }
      return `${errorType}: ${errorMessage}`;
    case 422:
      if (errorType === "IDEMPOTENCY_KEY_PAYLOAD_MISMATCH" || errorType === "UNKNOWN_ERROR") {
        return serverMessage
          ? `Idempotency-Key payload mismatch. ${said}Use a new key, or repeat the request exactly.`
          : "Idempotency-Key payload mismatch: you reused a key with different parameters. Use a new key, or repeat the request exactly.";
      }
      return `${errorType}: ${errorMessage}`;
    // 429 covers two limits (600 requests/minute and 50 in flight), and 502/503
    // carry a platform-specific cause and retry hint. Only the server knows
    // which, so its message leads and the fixed line is the no-body fallback.
    case 429:
      return serverMessage ?? "Too many concurrent requests on this API key (50 max). Wait a moment and retry.";
    case 502:
      return serverMessage
        ? `Upstream error. ${serverMessage}`
        : "Upstream error fetching data. Credits were auto-refunded; retry shortly.";
    case 503:
      return serverMessage
        ? `Service unavailable. ${serverMessage}`
        : `Platform ${options.platform} is temporarily unavailable. Credits were auto-refunded; retry in ~30s.`;
    default: {
      const docHint = docUrl ? ` See ${docUrl}` : "";
      return `Error ${status}: ${errorType} — ${errorMessage}${docHint}`;
    }
  }
}
