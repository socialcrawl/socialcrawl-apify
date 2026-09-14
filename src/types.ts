export interface ParamDef {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

/**
 * `object` / `array` are never emitted by the registry generator (the backend
 * only declares the four scalar kinds). They exist for the hand-written
 * non-registry families whose JSON bodies carry structured values — the
 * monitors `params`, `alert_rules` and `output_schema` fields, and the cohorts
 * `platforms` subset.
 */
export type OptionalParamType =
  | "string"
  | "boolean"
  | "integer"
  | "enum"
  | "object"
  | "array";

export interface OptionalParam {
  name: string;
  type: OptionalParamType;
  enumValues?: string[];
  /** Inclusive numeric bounds (integer params only). */
  minimum?: number;
  maximum?: number;
  /** This param is a silent no-op upstream unless the named sibling is also sent. */
  requires?: string;
  /** When this param is present, `param` must equal `value` (auto-injected when absent). */
  couplesWith?: { param: string; value: string };
  /** Transport on a non-GET endpoint. Defaults to the JSON body; `"query"` rides the URL. */
  in?: "query" | "body";
  description?: string;
  example?: string;
}

/** Per-entry constraint on a comma-separated LIST param. Applies to required params too. */
export interface CsvConstraint {
  /** Maximum comma-separated entries the upstream accepts. */
  max?: number;
  /** Allowed values for EACH entry. */
  enumValues?: string[];
}

export type PlatformCategory = string;

export interface Platform {
  slug: string;
  name: string;
  endpointCount: number;
  description: string;
  /** False for research / commerce / dev-ecosystem sources. */
  social: boolean;
  category?: PlatformCategory;
  /**
   * Stateful families that are NOT registry endpoints (`monitors`, `cohorts`).
   * They are excluded from the headline platform/endpoint counts.
   */
  nonRegistry?: true;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type CreditTier = "standard" | "advanced" | "premium";

/**
 * How an endpoint charges.
 *  - `ladder`  — the flat 1/5/10 tier rate, same credits every call.
 *  - `flat`    — a per-endpoint override off the ladder (e.g. 20cr Universal Search).
 *  - `metered` — query-dependent: an upfront ceiling is held and refunded down to
 *                the work actually done. `minCost`/`maxCost` bound the real charge.
 */
export type PricingModel = "ladder" | "flat" | "metered";

export interface Pricing {
  /** Static cost. For a metered endpoint this is only the base/floor, never the ceiling. */
  cost: number;
  tier: CreditTier;
  /** What this endpoint's tier would cost on the plain 1/5/10 ladder. */
  ladderCost: number;
  model: PricingModel;
  /** Lower bound of a metered charge. */
  minCost?: number;
  /** Upper bound of a metered charge — what the API holds up front. */
  maxCost?: number;
  /** Fixed page size when the meter bills per page. */
  pageSize?: number;
  /**
   * The upfront hold is computed per request from the inputs (today: a cohort
   * query, whose ceiling is the sum over members of page-cap x per-page cost),
   * so `maxCost` is the contractual ceiling, not the number actually held.
   */
  holdIsComputed?: true;
  /** Exact customer-facing wording for a dynamic price, authored in the registry. */
  description?: string;
}

export interface PaginationInfo {
  style: "cursor" | "offset" | "page";
  /** The upstream's native param. You always send the universal `cursor` instead. */
  nativeParam: string;
  /** Native page-size param the universal `limit` maps to, when supported. */
  limitParam?: string;
  /** Upper bound applied to `limit` before it is forwarded, when known. */
  limitMax?: number;
}

/**
 * Where the rows actually sit inside the `data` envelope, declared by the
 * backend rather than guessed. `data.items[]` for a list (with `itemKey`
 * naming the canonical object each row is), `data.<key>` for a singular
 * object. Absent on passthrough archetypes, where the upstream shape is
 * returned as-is and no canonical wrapper exists.
 */
export interface ResponseShape {
  /** e.g. `"data.items[]"`, `"data.author"`, `"data.page"`. */
  root: string;
  /** The canonical object kind of each row, e.g. `"post"`, `"web_page"`. */
  itemKey?: string;
}

/**
 * One `include=<token>` row join, exactly as the registry declares it.
 *
 * The endpoint runs its normal read, then reads `sibling` for the rows it got
 * back and folds `fills` onto each one. The charge is `creditsPerItem` per row
 * actually filled, capped at `maxItems` rows (or at `batch.creditCap` where the
 * sibling takes a batch), with cached and unfillable rows refunded.
 */
export interface HydrationJoin {
  /** The param carrying the token. `include` throughout today. */
  param: string;
  token: string;
  /** Public path of the endpoint whose read fills the rows, e.g. `pinterest/pin`. */
  sibling: string;
  siblingMethod?: string;
  /** The exact canonical leaves this token fills, e.g. `post.engagement.saves`. */
  fills: string[];
  creditsPerItem: number;
  /** Most rows this token will ever join on a single call. */
  maxItems: number;
  /** Rows joined when the caller sends no row limit, where it differs from `maxItems`. */
  defaultRowLimit?: number;
  /** The param that lowers the joined row count for this call. */
  rowLimitParam?: string;
  /** Where the sibling takes a batch, the whole join bills a flat cap. */
  batch?: { size: number; creditCap: number };
  /** Leaves the join replaces outright (a rounded count becoming the exact one). */
  replaceApproximate?: string[];
  /** Rows already in the sibling's cache are filled for free. */
  cacheSibling?: true;
  /** Codes the response's `_warnings` carries when the join could not complete. */
  warnings?: { unavailable?: string; partial?: string };
}

export interface CacheInfo {
  category: string;
  /** Seconds. A cache hit inside this window costs 0 credits. `0` = never cached. */
  ttlSeconds: number;
}

export type Execution = "sync" | "sse" | "async";

export interface Endpoint {
  platform: string;
  resource: string;
  method: HttpMethod;
  /** Required params. */
  params: ParamDef[];
  /** Optional params forwarded upstream when provided. */
  optionalParams: OptionalParam[];
  /**
   * Groups of mutually-substitutable params. Each inner array is a set
   * where at least ONE member must be provided at request time.
   * Members always live in `optionalParams`, never in `params`.
   */
  oneOfGroups: string[][];
  /** Constraints on comma-separated list params, keyed by param name. */
  csvConstraints?: Record<string, CsvConstraint>;
  creditTier: CreditTier;
  /** Static cost. Prefer `pricing` — this is the floor on a metered endpoint. */
  creditCost: number;
  pricing: Pricing;
  archetype: string;
  summary: string;
  description: string;
  /** `sync` (default), `sse` (streams when asked), or `async` (returns a job to poll). */
  execution?: Execution;
  /** How a streaming response is requested, when the endpoint supports one. */
  streaming?: string;
  /** Present when the endpoint pages. Send the universal `cursor`; style is informational. */
  pagination?: PaginationInfo;
  /**
   * The registry's own explicit paging declaration, where it makes one. Prefer
   * `isPaginatable()` in ./catalog.ts, which folds this together with
   * `pagination` and `singlePage` into the one answer callers actually want.
   */
  paginatable?: boolean;
  /** Reason this endpoint serves exactly one page even though it looks paginatable. */
  singlePage?: string;
  /** Reason this endpoint walks upstream pages server-side to fill one response. */
  collectUntilN?: string;
  /** Upstream 404 means "zero items", and is mapped to an empty list + refund. */
  emptyOn404?: true;
  cache: CacheInfo;
  /** Composite family, e.g. `prism`. */
  family?: string;
  /** UI grouping label for the stateful web routes. */
  group?: string;
  /** Short verb label for the stateful web routes, e.g. "Start Crawl". */
  actionLabel?: string;
  /** Extra contract facts worth surfacing before a call is billed. */
  contractDetails?: string[];
  /** Topic labels from the registry, searched alongside the path and prose. */
  tags?: string[];
  /** Where this endpoint's rows live in the envelope. Drives row extraction. */
  responseShape?: ResponseShape;
  /** Per-leaf documentation, for responses whose fields are not self-evident. */
  responseFields?: Record<string, string>;
  /**
   * The `include=…` row joins this endpoint offers, one entry per token.
   * Present only on endpoints that actually bill for a second read — the
   * free-form `include` on the composites and dossiers has no entry here.
   */
  hydration?: HydrationJoin[];
  /**
   * Explicit public path template, used by the non-registry stateful families
   * whose path is not `/v1/{platform}/{resource}` (`monitors`, `cohorts`).
   */
  path?: string;
  /** Params injected into every call (e.g. monitors `pause` sends `status=paused`). */
  fixedParams?: Record<string, unknown>;
  /**
   * The route requires an `Idempotency-Key` header (the cohort POST/PUT
   * routes). The Actor generates one per run when the user supplies none, so a
   * mutating call can never be rejected for a header the form does not have.
   */
  requiresIdempotencyKey?: true;
  /** True for a stateful family outside the registry — excluded from headline counts. */
  nonRegistry?: true;
}

/** Top-level `pagination` block on every list response (REL-09). */
export interface PaginationBlock {
  next_cursor: string | null;
  has_more: boolean;
  page_size: number;
}

export interface SocialCrawlSuccessResponse {
  success: true;
  platform: string;
  endpoint: string;
  data: unknown;
  credits_used: number;
  /**
   * `null` when the response did not establish a balance — a cache hit does no
   * ledger read, so it reports `credits_used: 0` and `credits_remaining: null`
   * rather than echoing a stale number.
   */
  credits_remaining: number | null;
  request_id: string;
  cached: boolean;
  pagination?: PaginationBlock;
}

export interface SocialCrawlErrorResponse {
  success: false;
  error: {
    type: string;
    message: string;
    status: number;
    doc_url?: string;
  };
  credits_remaining?: number;
  request_id?: string;
}

export type SocialCrawlResponse = SocialCrawlSuccessResponse | SocialCrawlErrorResponse;
