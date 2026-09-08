import type { Endpoint, Platform } from "../types.js";

/**
 * The `/v1/cohorts/*` + `/v1/cohort-queries/*` family — HAND-WRITTEN, not
 * generated.
 *
 * Cohorts answer the one question the rest of the API cannot: not "who is
 * talking about X?" but "which of THESE specific public identities is talking
 * about X?". You upload a panel you already have (a purchaser list, a customer
 * segment, a creator roster), submit a keyword query bounded to a recent
 * window, and get back the matching posts per member PLUS a coverage record
 * for every member — including the ones that matched nothing.
 *
 * Like `monitors`, this is a stateful module rather than registry endpoints, so
 * it is absent from registry-dump.json and from the headline platform/endpoint
 * counts — exactly as the backend counts them. `scripts/generate-data.ts` never
 * touches this file.
 *
 * Eight API operations across two path prefixes are exposed as eight Actor
 * resources. Everything is free except `query`, which is metered per successful
 * upstream page and refunds the unspent reservation exactly once.
 */

const COHORT_ID_PARAM = {
  name: "cohort_id",
  required: true,
  description:
    "The cohort's id — the `id` field of the `create` response. A 21-character id or a UUID.",
  example: "ziJygy91eDlzFJLzzUgIY",
} as const;

const QUERY_ID_PARAM = {
  name: "query_id",
  required: true,
  description:
    "The query's id, as returned by `query` (the `query_id` field of the 202 response).",
  example: "ziJygy91eDlzFJLzzUgIY",
} as const;

/** Every lifecycle call is free; only a running query bills. */
const FREE_PRICING = {
  cost: 0,
  tier: "standard",
  ladderCost: 1,
  model: "flat",
  description:
    "Free (0 credits) — creating a cohort, uploading members, reading status, cancelling, deleting and reading results never charge. Only `query` bills, per successful upstream page.",
} as const;

const NO_CACHE = { category: "search", ttlSeconds: 0 } as const;

/**
 * The ten platforms a cohort identity may belong to. Anything else is rejected
 * at member upload (400 COHORT_IDENTITY_PLATFORM_UNSUPPORTED) rather than at
 * query time, so an unsupported identity can never consume a reservation.
 */
export const COHORT_IDENTITY_PLATFORMS = [
  "instagram",
  "tiktok",
  "youtube",
  "twitter",
  "threads",
  "bluesky",
  "truth-social",
  "kwai",
  "twitch",
  "linkedin",
] as const;

export const COHORT_PLATFORM: Platform = {
  slug: "cohorts",
  name: "Cohorts",
  endpointCount: 8,
  social: false,
  nonRegistry: true,
  description:
    "Audience-filtered mention search over a panel YOU supply. Upload up to 10,000 public identities across 10 platforms (Instagram, TikTok, YouTube, X/Twitter, Threads, Bluesky, Truth Social, Kwai, Twitch, LinkedIn), then ask which of them posted your keywords in a recent window. Every result carries your own `external_id` so it joins straight back to your records, and every member gets a coverage row — including the ones that matched nothing — so a partial crawl can never read as \"nobody talked about you\". Identities are encrypted at rest and never read back. Managing a cohort is free; a query is metered per successful upstream page and refunds the unspent reservation. Not part of the registry endpoint count.",
};

export const COHORT_ENDPOINTS: Endpoint[] = [
  {
    platform: "cohorts",
    resource: "create",
    method: "POST",
    path: "/v1/cohorts",
    nonRegistry: true,
    requiresIdempotencyKey: true,
    params: [],
    optionalParams: [
      {
        name: "name",
        type: "string",
        description:
          "A human-readable label for the panel, up to 120 characters.",
        example: "August purchaser panel",
      },
      {
        name: "retention_days",
        type: "integer",
        minimum: 7,
        maximum: 90,
        description:
          "How long the cohort and everything under it is kept before automatic purge. Defaults to 30. Uploading members or submitting a query renews the clock.",
        example: "30",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Create a cohort",
    description:
      "Creates an empty panel and returns it as `id`, with its member count and retention window. An account may hold up to 100 cohorts (400 COHORT_LIMIT_EXCEEDED beyond that). Requires an `Idempotency-Key` — the Actor generates one per run when you do not supply the `idempotencyKey` input, and reports it, so a repeated run with the same key returns the original cohort instead of creating a second one.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Create Cohort",
    contractDetails: [
      "Only `platform` + `handle` + your own opaque `external_id` are ever sent. Whatever you used to build the panel stays on your side.",
      "Identities and external IDs are encrypted at rest and never appear in logs, job payloads, traces, or error responses.",
      "A cohort or query that is not yours returns 404, never 403 — a cross-tenant probe is indistinguishable from a resource that does not exist.",
    ],
  },
  {
    platform: "cohorts",
    resource: "members",
    method: "PUT",
    path: "/v1/cohorts/{cohort_id}/members",
    nonRegistry: true,
    requiresIdempotencyKey: true,
    params: [
      COHORT_ID_PARAM,
      {
        name: "members",
        required: true,
        description:
          'The identities to upsert, 1-1,000 per call (10,000 per cohort — send as many chunks as you need). Each entry is `{ "external_id": "your-own-key", "platform": "instagram", "handle": "natgeo" }`; LinkedIn takes the profile URL as its handle. `external_id` is optional but is what every match and coverage row is keyed by, so supply it.',
        example:
          '[{"external_id":"buyer_01983","platform":"instagram","handle":"natgeo"}]',
      },
    ],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Upload cohort members",
    description:
      "Upserts identities into the cohort by `external_id`, so a nightly full re-push is safe and does not inflate the count. Returns `inserted` / `updated` / `unchanged` and the new `member_count`. Two different `external_id`s claiming the same normalized identity is a 409 COHORT_IDENTITY_CONFLICT rather than a silent double-count. Requires an `Idempotency-Key`.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Upload Members",
    contractDetails: [
      `Supported identity platforms: ${COHORT_IDENTITY_PLATFORMS.join(", ")}. Facebook and Snapchat are rejected here with 400 COHORT_IDENTITY_PLATFORM_UNSUPPORTED, before a query can reserve credits for them.`,
      "1,000 identities per call, 10,000 per cohort.",
    ],
  },
  {
    platform: "cohorts",
    resource: "get",
    method: "GET",
    path: "/v1/cohorts/{cohort_id}",
    nonRegistry: true,
    params: [COHORT_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Get cohort metadata",
    description:
      "Returns the cohort's counts, retention window and status. It deliberately never enumerates the stored identities back to you — they are encrypted at rest and there is no route that reads them.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Get Cohort",
  },
  {
    platform: "cohorts",
    resource: "delete",
    method: "DELETE",
    path: "/v1/cohorts/{cohort_id}",
    nonRegistry: true,
    params: [COHORT_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Delete a cohort",
    description:
      "Removes the cohort and cascades its members, queries and results, cancelling anything still in flight and refunding the unspent reservation. Irreversible. Your credit-ledger receipts are never deleted — billing history survives the data.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Delete Cohort",
  },
  {
    platform: "cohorts",
    resource: "query",
    method: "POST",
    path: "/v1/cohorts/{cohort_id}/queries",
    nonRegistry: true,
    requiresIdempotencyKey: true,
    params: [
      COHORT_ID_PARAM,
      {
        name: "keywords",
        required: true,
        description:
          'The terms to match, 1-20 of them, as a JSON array. Matching is literal, whole-word and deterministic — no stemming, fuzzy matching, semantic expansion or brand-alias inference. If you want "Acme" to also catch "AcmeCo", pass both.',
        example: '["acme", "acme pro"]',
      },
      {
        name: "date_from",
        required: true,
        description:
          "How far back each crawl reaches, as a full RFC3339 timestamp (not a bare calendar date).",
        example: "2026-08-01T00:00:00.000Z",
      },
      {
        name: "max_pages_per_identity",
        required: true,
        description:
          "Page budget per member, 1-20. No default. The single-page platforms (X/Twitter, Bluesky, Threads, Twitch) ignore anything above 1 and are costed at 1 page in the ceiling.",
        example: "3",
      },
      {
        name: "max_items_per_identity",
        required: true,
        description: "Item budget per member, 1-1,000. No default.",
        example: "100",
      },
      {
        name: "max_credits",
        required: true,
        description:
          "Your own safety limit. Submission fails with a 400 if the computed worst-case ceiling exceeds it — BEFORE any credit is held. It is never permission to spend beyond the ceiling.",
        example: "30000",
      },
    ],
    optionalParams: [
      {
        name: "date_to",
        type: "string",
        description:
          "Upper bound of the window, as a full RFC3339 timestamp. Must not be earlier than `date_from`.",
        example: "2026-09-01T00:00:00.000Z",
      },
      {
        name: "platforms",
        type: "array",
        description:
          "Restrict the run to a subset of the platforms present in the cohort, as a JSON array. Omit to query all of them.",
        example: '["instagram", "youtube"]',
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: {
      cost: 0,
      tier: "standard",
      ladderCost: 1,
      model: "metered",
      minCost: 0,
      maxCost: 1_000_000,
      holdIsComputed: true,
      description:
        "Charged per SUCCESSFUL upstream page: 1 credit per page on most platforms, 2 for Instagram and YouTube (each runs two routes per member), 5 for LinkedIn. Submission reserves the computed worst-case ceiling — the sum over members of (page cap x credits per page) — and fails before holding anything if that exceeds the `max_credits` you set. Failed, timed-out, cancelled and skipped pages cost nothing, and the unspent reservation is refunded exactly once, so `actual + refunded` always equals `reserved`.",
    },
    archetype: "Analytics",
    execution: "async",
    summary: "Submit a cohort query",
    description:
      "Returns 202 immediately with a `query_id`, the reservation, and the status/result URLs — the work runs asynchronously. Poll `query/status` until it reports `succeeded`, then read `query/results`. Requires an `Idempotency-Key`: replaying the same key with the same body returns the original query rather than reserving a second one.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Run Query",
    contractDetails: [
      "202, not 200 — this is the only asynchronous surface in the Actor. Nothing is billed until a page actually succeeds.",
      "All three caps (`max_pages_per_identity`, `max_items_per_identity`, `max_credits`) are required and none of them has a default.",
      "Only content the source attributes to the identity you supplied is eligible. Profile lookups resolve the account and its feed cursor; they never become results.",
    ],
  },
  {
    platform: "cohorts",
    resource: "query/status",
    method: "GET",
    path: "/v1/cohort-queries/{query_id}",
    nonRegistry: true,
    params: [QUERY_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Poll a cohort query",
    description:
      "Reports `queued` -> `running` -> `succeeded` (or `failed`, `cancelled`, `expired`) plus durable progress counters — `members_completed`, `shards_completed`, `pages_succeeded`, `pages_failed` — and the live billing figures, so a long run is observable rather than opaque. Free, so poll it as often as you like.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Check Query",
  },
  {
    platform: "cohorts",
    resource: "query/cancel",
    method: "DELETE",
    path: "/v1/cohort-queries/{query_id}",
    nonRegistry: true,
    params: [QUERY_ID_PARAM],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "Analytics",
    summary: "Cancel a cohort query",
    description:
      "Stops the query: queued work never starts and running work stops at the next page boundary. Pages already fetched stay billable and the unspent reservation is refunded once. A query that is already terminal returns 409 COHORT_QUERY_NOT_CANCELLABLE.",
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Cancel Query",
  },
  {
    platform: "cohorts",
    resource: "query/results",
    method: "GET",
    path: "/v1/cohort-queries/{query_id}/results",
    nonRegistry: true,
    params: [QUERY_ID_PARAM],
    optionalParams: [
      {
        name: "cursor",
        type: "string",
        description: "Pagination cursor from the previous page's `next_cursor`.",
      },
      {
        name: "limit",
        type: "integer",
        minimum: 1,
        maximum: 500,
        description: "Rows per page. Defaults to 100.",
        example: "100",
      },
    ],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 0,
    pricing: FREE_PRICING,
    archetype: "PostList",
    summary: "Read cohort query results",
    description:
      "Matches plus per-member coverage, cursor-paginated and free. Each match carries your `external_id`, the canonical URL, the publish time, a text excerpt, the normalized `matched_keywords` and the route it came from. `coverage` has one record per member whether or not it matched — `window_complete: false` means the page budget ran out or the account was unreachable, so there may be posts you did not see. Only a SUCCEEDED query serves results (409 COHORT_QUERY_NOT_READY otherwise). Set `maxItems` to walk every page in one run — these pages are free.",
    pagination: {
      style: "cursor",
      nativeParam: "cursor",
      limitParam: "limit",
      limitMax: 500,
    },
    cache: NO_CACHE,
    family: "cohorts",
    group: "Cohorts",
    actionLabel: "Read Results",
    contractDetails: [
      "`coverage` is paginated exactly like `items`, so a 10,000-member panel takes at least 20 pages at limit=500 even when nothing matched. Later pages can carry an empty `items` array and still carry coverage — accumulate both streams until the cursor is null.",
      "Pages are additionally bounded so the serialized body never exceeds 1 MB. A page smaller than your `limit` for that reason is NOT the end of the result set.",
      "Read `coverage` before treating a result set as exhaustive: a query can be `succeeded` while individual members report `not_found` or `failed`.",
    ],
  },
];

/** Cohort and query ids are interpolated into the URL path; keep them URL-safe. */
export const COHORT_ID_PATTERN =
  /^(?:[0-9A-Za-z]{21}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;

/** Body fields that carry structured JSON and may arrive as a typed-in string. */
const JSON_BODY_FIELDS = ["members", "keywords", "platforms"] as const;

/**
 * Normalise the Actor's flat `params` into the JSON body the cohort routes
 * want. `members`, `keywords` and `platforms` are arrays; when they are typed
 * into a text field rather than the JSON editor they arrive as strings, and a
 * string where the API wants an array is a 400 the user cannot read.
 *
 * `retention_days`, `max_credits` and the two per-identity caps are strict
 * integers on the wire — the API's `.strict()` schemas reject the string forms
 * a form field produces, so they are coerced here.
 */
export function prepareCohortBody(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...params };

  for (const key of JSON_BODY_FIELDS) {
    const value = out[key];
    if (typeof value !== "string") continue;
    try {
      out[key] = JSON.parse(value);
    } catch {
      // Leave it as-is — the API returns a precise validation error.
    }
  }

  for (const key of [
    "retention_days",
    "max_credits",
    "max_items_per_identity",
    "max_pages_per_identity",
    "limit",
  ]) {
    const value = out[key];
    if (typeof value !== "string" || value.trim() === "") continue;
    const n = Number(value);
    if (Number.isInteger(n)) out[key] = n;
  }

  return out;
}
