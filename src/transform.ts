import type { SocialCrawlSuccessResponse } from "./types.js";

/** Coerce an arbitrary params object into the string map the API expects. */
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
 * JSON body keeps its numbers, booleans, and arrays (e.g. web/crawl `limit`,
 * `formats`) instead of stringifying them the way a query string would.
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

/**
 * Flattens an API envelope into dataset rows. List responses become one row per
 * item; single-object responses become one row. Credit/meta fields are attached
 * under `_sc_`-prefixed keys so they never collide with platform data fields.
 */
export function rowsFromEnvelope(
  platform: string,
  resource: string,
  envelope: SocialCrawlSuccessResponse | null,
  raw: string,
  endpointPath?: string,
): Record<string, unknown>[] {
  const meta = {
    _sc_platform: platform,
    _sc_endpoint: endpointPath ?? `/v1/${platform}/${resource}`,
    _sc_credits_used: envelope?.credits_used ?? null,
    _sc_credits_remaining: envelope?.credits_remaining ?? null,
    _sc_request_id: envelope?.request_id ?? null,
    _sc_cached: envelope?.cached ?? null,
  };

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
