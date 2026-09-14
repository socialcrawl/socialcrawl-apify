import type { Endpoint, SocialCrawlSuccessResponse } from "./types.js";

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
  /**
   * The endpoint that produced this page. When it declares a `responseShape`,
   * rows are taken from exactly where the registry says they live instead of
   * being guessed at, and each row is labelled with the canonical object kind.
   */
  endpoint?: Endpoint;
}

/**
 * Row-join telemetry the API attaches to a hydrated response (`data.hydration`):
 * how many rows the join attempted, how many it filled, what it held and what
 * it kept. It is the receipt for the extra credits a join spends, so it is
 * lifted onto every row rather than left buried in the envelope.
 */
function hydrationMeta(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const block = (data as Record<string, unknown>).hydration;
  if (!block || typeof block !== "object" || Array.isArray(block)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(block as Record<string, unknown>)) {
    // Scalars only: a nested object would bloat every row of the page.
    if (value === null || typeof value !== "object") out[`_sc_hydration_${key}`] = value;
  }
  return out;
}

/**
 * Read the rows out of `data` at the path the registry declares.
 *
 * `responseShape.root` is either `data.items[]` (a list) or `data.<key>` (one
 * object). Returns `null` when the declared path is not actually present, so
 * the caller falls back to the structural guess rather than emitting nothing —
 * a snapshot that has drifted from the live API must never cost someone the
 * rows they just paid for.
 */
function rowsAtDeclaredPath(
  endpoint: Endpoint | undefined,
  data: unknown,
): unknown[] | null {
  const root = endpoint?.responseShape?.root;
  if (!root || !data || typeof data !== "object") return null;

  const isList = root.endsWith("[]");
  const key = root.replace(/^data\./, "").replace(/\[\]$/, "");
  const value = (data as Record<string, unknown>)[key];
  if (value === undefined || value === null) return null;

  if (isList) return Array.isArray(value) ? value : null;
  return [value];
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
  const data: unknown = envelope ? envelope.data : safeParse(raw);
  const itemKey = options.endpoint?.responseShape?.itemKey;

  const meta: Record<string, unknown> = {
    _sc_platform: platform,
    _sc_endpoint: endpointPath ?? `/v1/${platform}/${resource}`,
    _sc_credits_used: envelope?.credits_used ?? null,
    _sc_credits_remaining: envelope?.credits_remaining ?? null,
    _sc_request_id: envelope?.request_id ?? null,
    _sc_cached: envelope?.cached ?? null,
    ...(itemKey ? { _sc_item_kind: itemKey } : {}),
    ...hydrationMeta(data),
  };
  if (options.pageIndex !== undefined) meta._sc_page = options.pageIndex + 1;

  // Where the registry says the rows are, if it says. The structural guess
  // below stays as the fallback for the passthrough archetypes that declare no
  // shape, and for a snapshot that has drifted from the live response.
  let items = rowsAtDeclaredPath(options.endpoint, data);

  if (items === null) {
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
