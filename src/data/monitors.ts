import type { Endpoint, Platform } from "../types.js";

/**
 * The `/v1/monitors/*` family — HAND-WRITTEN, not generated.
 *
 * Monitors re-run any registered endpoint or Prism composite on a cadence,
 * deliver each result to an HMAC-signed webhook, evaluate a small alert DSL,
 * and accumulate a per-run time-series. They are a stateful module rather than
 * registry endpoints, so they are absent from registry-dump.json and from the
 * headline platform/endpoint counts — exactly as the backend counts them.
 * `scripts/generate-data.ts` never touches this file.
 *
 * Seven API operations are exposed as eight Actor resources: `pause` and
 * `resume` are the same `PATCH` with the `status` body field pinned, because
 * "pause this monitor" is the thing a user actually wants to express.
 *
 * Billing: every operation here is free. A monitor's SCHEDULED RUNS bill the
 * underlying recipe's normal cost plus 1 credit for orchestration. A run that
 * would overdraw the balance is skipped at 0 credits; a failed run is refunded.
 */

const MONITOR_ID_PARAM = {
  name: "monitor_id",
  required: true,
  description:
    "The monitor's id, as returned by `create` or `list`. 1-64 characters of letters, digits, `_` or `-`.",
  example: "mon_7f3c9a2b",
} as const;

/** Free to call; the recurring runs are what cost credits. */
const FREE_PRICING = {
  cost: 0,
  tier: "standard",
  ladderCost: 1,
  model: "flat",
  description:
    "Free (0 credits) — managing monitors never charges. Each SCHEDULED RUN bills the recipe's own cost plus 1 credit for orchestration.",
} as const;

const NO_CACHE = { category: "search", ttlSeconds: 0 } as const;

export const MONITOR_PLATFORM: Platform = {
  slug: "monitors",
  name: "Monitors",
  endpointCount: 8,
  social: false,
  nonRegistry: true,
  description:
    "Scheduled re-runs of any SocialCrawl endpoint or Prism composite — hourly, daily, weekly, or on a cron. Each run is delivered to an HMAC-signed webhook, evaluated against a small alert DSL, and appended to a per-monitor time-series you can query. Managing monitors is free; each scheduled run bills its recipe's cost plus 1 credit. Not part of the registry endpoint count.",
};

export const MONITOR_ENDPOINTS: Endpoint[] = [
  {
    platform: "monitors",
    resource: "create",
    method: "POST",
    path: "/v1/monitors",
    nonRegistry: true,
    params: [
      {
        name: "recipe",
        required: true,
        description:
          "The endpoint or composite to re-run each cycle, as `platform/resource` — any registry endpoint (`tiktok/profile`) or Prism composite (`prism/brand-mentions`).",
        example: "prism/brand-mentions",
      },
      {
        name: "cadence",
        required: true,
        description:
          "How often to run: `hourly`, `daily`, `weekly`, or a 5-field cron expression (e.g. `0 */6 * * *`). Anything that is not one of the three presets is sent as a cron expression.",
        example: "daily",
      },
      {
        name: "webhook_url",
        required: true,
        description:
          "HTTPS URL that receives each run's result. Deliveries are signed with an HMAC header so you can verify them.",
        example: "https://example.com/hooks/socialcrawl",
      },
    ],
    optionalParams: [
      {
        name: "params",
        type: "object",
        description:
          "Parameters passed to the recipe on every run — the same JSON you would send to that endpoint directly.",
        example: '{"brand":"acme"}',
      },
      {
        name: "name",
        type: "string",
        description: "A human-readable label for the monitor.",
        example: "Acme daily brand watch",
      },
      {
        name: "alert_rules",
        type: "array",
        description:
          "Rules evaluated after each run, as `[{metric, op, value, window?}]`. `op` is one of gt, lt, gte, lte, abs_change_gt, pct_change_gt, pct_change_lt; the three change ops compare against the previous comparable run and accept a `window` of `1d` or `1w`.",
        example: '[{"metric":"total_mentions","op":"pct_change_gt","value":25}]',
      },
      {
        name: "suppress_webhook_unless_alert",
        type: "boolean",
        description:
          "When true, only deliver the webhook on runs where at least one alert rule fired. Defaults to false (every run is delivered).",
        example: "true",
      },
      {
        name: "output_schema",
        type: "object",
        description:
          "Optional JSON schema describing the shape you want each run's result reduced to before delivery.",
      },
      {
        name: "webhook_secret",
        type: "string",
        description:
          "Bring your own HMAC signing secret (8-200 characters). Omit it and one is generated and returned once, on this create response only.",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Create a scheduled monitor",
    description:
      "Registers a recipe to re-run on a cadence. Returns the monitor plus, when you did not supply one, the generated `webhook_secret` — this is the ONLY response that ever contains it, so store it now. Creating a monitor is free; each scheduled run bills the recipe's normal cost plus 1 credit.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Create Monitor",
  },
  {
    platform: "monitors",
    resource: "list",
    method: "GET",
    path: "/v1/monitors",
    nonRegistry: true,
    params: [],
    optionalParams: [
      {
        name: "status",
        type: "enum",
        enumValues: ["active", "paused", "all"],
        description: "Filter by monitor status.",
        example: "active",
      },
      {
        name: "cursor",
        type: "string",
        description: "Pagination cursor from the previous page.",
      },
      {
        name: "limit",
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Monitors per page. Defaults to 20.",
        example: "50",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "List your monitors",
    description:
      "Returns every monitor on your API key, newest first, with its recipe, cadence, status, and last-run summary.",
    pagination: { style: "cursor", nativeParam: "cursor", limitParam: "limit", limitMax: 100 },
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "List Monitors",
  },
  {
    platform: "monitors",
    resource: "get",
    method: "GET",
    path: "/v1/monitors/{monitor_id}",
    nonRegistry: true,
    params: [MONITOR_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Get one monitor",
    description:
      "Returns a single monitor's full configuration and current status. 404s when the monitor does not exist on your API key.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Get Monitor",
  },
  {
    platform: "monitors",
    resource: "runs",
    method: "GET",
    path: "/v1/monitors/{monitor_id}/runs",
    nonRegistry: true,
    params: [MONITOR_ID_PARAM],
    optionalParams: [
      {
        name: "status",
        type: "enum",
        enumValues: ["ok", "partial", "failed", "skipped"],
        description:
          "Filter by run outcome. `skipped` runs were passed over for insufficient balance and cost nothing.",
        example: "failed",
      },
      {
        name: "from",
        type: "string",
        description: "Only runs at or after this ISO-8601 timestamp.",
        example: "2026-08-01T00:00:00Z",
      },
      {
        name: "to",
        type: "string",
        description: "Only runs at or before this ISO-8601 timestamp.",
        example: "2026-08-18T00:00:00Z",
      },
      {
        name: "cursor",
        type: "string",
        description: "Pagination cursor from the previous page.",
      },
      {
        name: "limit",
        type: "integer",
        minimum: 1,
        maximum: 100,
        description: "Runs per page. Defaults to 20.",
        example: "50",
      },
      {
        name: "include",
        type: "enum",
        enumValues: ["result"],
        description:
          "Set to `result` to inline each run's full recipe output instead of just its summary.",
        example: "result",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Get a monitor's run history",
    description:
      "Paginated history of every scheduled run — timestamp, outcome, credits charged, fired alerts, and (with `include=result`) the run's full output.",
    pagination: { style: "cursor", nativeParam: "cursor", limitParam: "limit", limitMax: 100 },
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "List Runs",
  },
  {
    platform: "monitors",
    resource: "timeseries",
    method: "GET",
    path: "/v1/monitors/{monitor_id}/timeseries",
    nonRegistry: true,
    params: [MONITOR_ID_PARAM],
    optionalParams: [
      {
        name: "metric",
        type: "string",
        description:
          "Comma-separated metric keys to return. Omit for every metric the monitor has accumulated.",
        example: "total_mentions,sentiment_score",
      },
      {
        name: "from",
        type: "string",
        description: "Only points at or after this ISO-8601 timestamp.",
        example: "2026-08-01T00:00:00Z",
      },
      {
        name: "to",
        type: "string",
        description: "Only points at or before this ISO-8601 timestamp.",
        example: "2026-08-18T00:00:00Z",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Get a monitor's metric time-series",
    description:
      "The headline read — one point per run per metric, so you can chart how a number moved over time without replaying the raw results.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Get Time-series",
  },
  {
    platform: "monitors",
    resource: "pause",
    method: "PATCH",
    path: "/v1/monitors/{monitor_id}",
    nonRegistry: true,
    fixedParams: { status: "paused" },
    params: [MONITOR_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Pause a monitor",
    description:
      "Stops the schedule without deleting anything. History and time-series are kept, and `resume` picks the cadence back up.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Pause Monitor",
  },
  {
    platform: "monitors",
    resource: "resume",
    method: "PATCH",
    path: "/v1/monitors/{monitor_id}",
    nonRegistry: true,
    fixedParams: { status: "active" },
    params: [MONITOR_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Resume a paused monitor",
    description: "Puts a paused monitor back on its cadence.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Resume Monitor",
  },
  {
    platform: "monitors",
    resource: "delete",
    method: "DELETE",
    path: "/v1/monitors/{monitor_id}",
    nonRegistry: true,
    params: [MONITOR_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Delete a monitor",
    description:
      "Unschedules the monitor and removes its run history and time-series. Irreversible — use `pause` to stop it temporarily.",
    cache: NO_CACHE,
    family: "monitors",
    group: "Monitors",
    actionLabel: "Delete Monitor",
  },
];

/** Monitor ids are interpolated into the URL path; keep them URL-safe. */
export const MONITOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

const CADENCE_PRESETS = new Set(["hourly", "daily", "weekly"]);

/**
 * Normalise the Actor's flat `params` into the JSON body `/v1/monitors` wants.
 *
 * Two shape mismatches to bridge: `cadence` is a union on the wire (one of the
 * three preset strings, or `{ cron }`), and `params` / `alert_rules` /
 * `output_schema` may arrive as JSON strings when they were typed into a
 * text field rather than the JSON editor.
 */
export function prepareMonitorBody(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };

  if (typeof out.cadence === "string") {
    const cadence = out.cadence.trim();
    out.cadence = CADENCE_PRESETS.has(cadence) ? cadence : { cron: cadence };
  }

  for (const key of ["params", "alert_rules", "output_schema"]) {
    const value = out[key];
    if (typeof value !== "string") continue;
    try {
      out[key] = JSON.parse(value);
    } catch {
      // Leave it as-is — the API will return a precise validation error.
    }
  }

  return out;
}
