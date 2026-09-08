import { ALL_ENDPOINTS, publicPath } from "./catalog.js";
import { callApi, type ClientConfig } from "./client.js";
import type { Endpoint, SocialCrawlSuccessResponse } from "./types.js";

/**
 * The `utility` platform — SocialCrawl's own Developer Experience surface.
 *
 * Four free (0-credit) endpoints that describe the API *from the API*, at
 * request time:
 *
 *   utility/quickstart — auth, base URL, envelope, billing, the full error
 *                        taxonomy, rate limits, pagination, and a first call.
 *   utility/endpoints  — the machine-readable catalog of everything callable.
 *   utility/endpoint   — the complete usage guide for ONE endpoint, including
 *                        a copy-paste curl and an example response.
 *   utility/llms       — the agent context corpus (markdown or structured JSON).
 *
 * Why this module exists rather than leaving them to the generic `request`
 * action: everything else in this Actor answers from a BUNDLED registry
 * snapshot, which is only as fresh as the last release. These four answer from
 * the live registry. They are the Actor's ground truth, and `compareCatalog`
 * below turns that into the one thing a snapshot can never tell you about
 * itself — whether it has gone stale.
 *
 * All four require an API key (every /v1 route is authed) but cost 0 credits.
 */

export type UtilityResource = "quickstart" | "endpoints" | "endpoint" | "llms";

export interface UtilityResult<T = Record<string, unknown>> {
  ok: boolean;
  /** The `data` payload of the envelope. */
  data: T | null;
  /** The untouched envelope, for OUTPUT. */
  envelope: SocialCrawlSuccessResponse | null;
  path: string;
  errorMessage?: string;
}

/** Call one utility endpoint. Free, but still needs the API key. */
export async function callUtility<T = Record<string, unknown>>(
  config: ClientConfig,
  resource: UtilityResource,
  params: Record<string, unknown> = {},
): Promise<UtilityResult<T>> {
  const result = await callApi(config, {
    platform: "utility",
    resource,
    params,
  });

  const envelope = result.json as SocialCrawlSuccessResponse | null;
  if (!result.ok) {
    return {
      ok: false,
      data: null,
      envelope,
      path: result.path,
      errorMessage: result.errorMessage ?? `Request failed (HTTP ${result.status}).`,
    };
  }

  return {
    ok: true,
    data: (envelope?.data ?? null) as T | null,
    envelope,
    path: result.path,
  };
}

// ── Payload shapes (mirrors of the registry's documented contract) ────────

/** One row of `utility/endpoints`. */
export interface CatalogRow {
  id: string;
  path: string;
  method: string;
  platform: string;
  resource: string;
  summary: string;
  credits: number;
  /** The honest label — e.g. "2-200 (metered)", not the base cost. */
  credits_label: string;
  archetype: string;
  required_params: string[];
  one_of: string[][];
  optional_params: string[];
  paginated: boolean;
  /** Path of the per-endpoint guide, e.g. `/v1/utility/endpoint?id=tiktok/profile`. */
  how_to_use: string;
  docs_url: string;
}

export interface EndpointCatalog {
  kind: "endpoint_catalog";
  stats: { platforms: number; endpoints: number; social_platforms: number };
  filters: { platform: string | null; search: string | null; method: string | null };
  total: number;
  endpoints: CatalogRow[];
}

export interface AgentContext {
  kind: "agent_context";
  format: "markdown" | "json";
  scope: string;
  /** Present when `format=markdown` — the llms corpus text. */
  content?: string;
  /** Present when `format=json` — the structured mirror. */
  context?: Record<string, unknown>;
  links?: Record<string, string>;
}

// ── Drift detection ──────────────────────────────────────────────────────

export type DriftKind =
  | "missing_from_actor"
  | "missing_from_api"
  | "cost_changed"
  | "params_changed"
  | "pagination_changed";

export interface DriftFinding {
  kind: DriftKind;
  id: string;
  method: string;
  detail: string;
  /** What the live API says. */
  api: string | null;
  /** What this Actor's bundled snapshot says. */
  actor: string | null;
}

export interface DriftReport {
  in_sync: boolean;
  api_endpoints: number;
  actor_endpoints: number;
  findings: DriftFinding[];
  /** Counts by kind, for the run summary. */
  totals: Record<DriftKind, number>;
}

function sortedSet(names: readonly string[]): string {
  return [...names].sort().join(",");
}

/**
 * Compare the live catalog against the bundled snapshot.
 *
 * A bundled snapshot cannot tell you it has gone stale, and the failure is
 * silent in both directions: an endpoint the API has gained is simply
 * invisible here, and one it has withdrawn still validates locally and then
 * 404s over the wire. This is the only check that catches either.
 *
 * Scope note: the comparison covers REGISTRY endpoints only. The non-registry
 * `monitors` and `cohorts` families are absent from `utility/endpoints` by
 * design, so counting them would report permanent phantom drift.
 */
export function compareCatalog(
  live: CatalogRow[],
  bundled: Endpoint[] = ALL_ENDPOINTS,
): DriftReport {
  const registryBundled = bundled.filter((e) => !e.nonRegistry);

  const key = (id: string, method: string): string => `${method} ${id}`;
  const liveByKey = new Map(live.map((r) => [key(r.id, r.method), r]));
  const actorByKey = new Map(
    registryBundled.map((e) => [key(`${e.platform}/${e.resource}`, e.method), e]),
  );

  const findings: DriftFinding[] = [];

  for (const [k, row] of liveByKey) {
    if (actorByKey.has(k)) continue;
    findings.push({
      kind: "missing_from_actor",
      id: row.id,
      method: row.method,
      detail: `The API serves ${row.method} ${row.path} (${row.credits_label}) but this Actor's bundled catalog does not list it. You can still call it — set platform/resource directly — but local validation will reject it first. Regenerate the Actor's data to pick it up.`,
      api: row.summary,
      actor: null,
    });
  }

  for (const [k, e] of actorByKey) {
    if (liveByKey.has(k)) continue;
    findings.push({
      kind: "missing_from_api",
      id: `${e.platform}/${e.resource}`,
      method: e.method,
      detail: `This Actor lists ${e.method} ${publicPath(e)} but the live API no longer serves it. Calling it will 404 — treat the bundled entry as withdrawn.`,
      api: null,
      actor: e.summary,
    });
  }

  for (const [k, row] of liveByKey) {
    const e = actorByKey.get(k);
    if (!e) continue;
    const id = row.id;

    if (row.credits !== e.pricing.cost) {
      findings.push({
        kind: "cost_changed",
        id,
        method: row.method,
        detail: `Credit cost moved. Budget against the API's number, not this Actor's.`,
        // `credits_label` already contains the number (and the metered band),
        // so quoting both reads as "5 (5 (advanced))".
        api: row.credits_label || String(row.credits),
        actor: String(e.pricing.cost),
      });
    }

    const apiRequired = sortedSet(row.required_params);
    const actorRequired = sortedSet(e.params.map((p) => p.name));
    const apiOptional = sortedSet(row.optional_params);
    const actorOptional = sortedSet(e.optionalParams.map((p) => p.name));

    if (apiRequired !== actorRequired) {
      findings.push({
        kind: "params_changed",
        id,
        method: row.method,
        detail: "Required parameters differ — a call this Actor accepts may be rejected, or vice versa.",
        api: apiRequired || "(none)",
        actor: actorRequired || "(none)",
      });
    }
    if (apiOptional !== actorOptional) {
      findings.push({
        kind: "params_changed",
        id,
        method: row.method,
        detail: "Optional parameters differ — newly added ones are flagged as undocumented by local validation.",
        api: apiOptional || "(none)",
        actor: actorOptional || "(none)",
      });
    }

    const actorPaginated = Boolean(e.pagination);
    if (row.paginated !== actorPaginated) {
      findings.push({
        kind: "pagination_changed",
        id,
        method: row.method,
        detail: "Pagination support differs — auto-pagination may be skipped, or attempted where it does not apply.",
        api: String(row.paginated),
        actor: String(actorPaginated),
      });
    }
  }

  const totals: Record<DriftKind, number> = {
    missing_from_actor: 0,
    missing_from_api: 0,
    cost_changed: 0,
    params_changed: 0,
    pagination_changed: 0,
  };
  for (const f of findings) totals[f.kind] += 1;

  findings.sort(
    (a, b) => a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id),
  );

  return {
    in_sync: findings.length === 0,
    api_endpoints: live.length,
    actor_endpoints: registryBundled.length,
    findings,
    totals,
  };
}

/** One-line summary of a drift report, for the run status message. */
export function summarizeDrift(report: DriftReport): string {
  if (report.in_sync) {
    return `In sync — all ${report.api_endpoints} live endpoints match this Actor's bundled catalog.`;
  }
  const parts: string[] = [];
  if (report.totals.missing_from_actor) {
    parts.push(`${report.totals.missing_from_actor} new on the API`);
  }
  if (report.totals.missing_from_api) {
    parts.push(`${report.totals.missing_from_api} withdrawn`);
  }
  if (report.totals.cost_changed) {
    parts.push(`${report.totals.cost_changed} repriced`);
  }
  if (report.totals.params_changed) {
    parts.push(`${report.totals.params_changed} param change(s)`);
  }
  if (report.totals.pagination_changed) {
    parts.push(`${report.totals.pagination_changed} pagination change(s)`);
  }
  return `Out of date: ${parts.join(", ")}. The live API is authoritative — see the dataset for each difference.`;
}
