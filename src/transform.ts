import type { SocialCrawlSuccessResponse } from "./types.js";

/** Coerce an arbitrary params object into the string map a query string expects. */
export function stringifyParams(
  raw: Record<string, unknown> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

/**
 * Drop empty (undefined/null/"") values but PRESERVE types — so a POST/PATCH
 * JSON body keeps its numbers, booleans, arrays, and nested objects (e.g.
 * web/crawl `limit` and `formats`, or a monitor's `alert_rules`) instead of
 * stringifying them the way a query string would.
 */
export function cleanParams(
  raw: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}

export interface RowMetaOptions {
  /** 0-based page index, set when a run walked more than one page. */
  pageIndex?: number;
}

/**
 * Flattens an API envelope into dataset rows. List responses become one row per
 * item; single-object responses become one row. Credit/request metadata is
 * attached under `_sc_`-prefixed keys so it never collides with platform data
 * fields.
 */
export function rowsFromEnvelope(
  platform: string,
  resource: string,
  envelope: SocialCrawlSuccessResponse | null,
  raw: string,
  endpointPath?: string,
  options: RowMetaOptions = {},
): Record<string, unknown>[] {
  const meta: Record<string, unknown> = {
    _sc_platform: platform,
    _sc_endpoint: endpointPath ?? `/v1/${platform}/${resource}`,
    _sc_credits_used: envelope?.credits_used ?? null,
    _sc_credits_remaining: envelope?.credits_remaining ?? null,
    _sc_request_id: envelope?.request_id ?? null,
    _sc_cached: envelope?.cached ?? null,
  };
  if (options.pageIndex !== undefined) meta._sc_page = options.pageIndex + 1;

  const data: unknown = envelope ? envelope.data : safeParse(raw);

  let items: unknown[];
  if (Array.isArray(data)) {
    items = data;
  } else if (
    data &&
    typeof data === "object" &&
    Array.isArray((data as Record<string, unknown>).items)
  ) {
    items = (data as { items: unknown[] }).items;
  } else {
    items = [data];
  }

  return items.map((item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? { ...(item as Record<string, unknown>), ...meta }
      : { value: item, ...meta },
  );
}

export function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
