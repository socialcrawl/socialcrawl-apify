import { publicPath } from "./catalog.js";
import { BILLING_URL, DOCS_URL, SIGNUP_URL } from "./constants.js";
import { CREDIT_LADDER, REGISTRY_STATS } from "./data/stats.js";
import type { Endpoint } from "./types.js";

/**
 * Everything the Actor knows about what a call will cost.
 *
 * The registry distinguishes three billing shapes and the difference matters to
 * anyone sizing a run, so nothing here infers a shape from the number:
 *
 *   ladder  — the flat 1/5/10 tier rate. Same credits every call.
 *   flat    — a per-endpoint override off the ladder (Universal Search at 20,
 *             the web agent at 25, the Prism composites, …).
 *   metered — query-dependent. The API holds an upfront CEILING and refunds
 *             down to the work actually done, so a single number would
 *             under-report the charge on a big request and over-report it on a
 *             small one. These carry a `minCost`/`maxCost` band, and often the
 *             exact authored wording for how the meter ticks.
 *
 * A metered endpoint's `credit_cost` is its floor, never its price. Anything
 * quoting one number for these is wrong; quote the band.
 */

/** Effective billing shape, folding the 0-credit endpoints out of `flat`. */
export type EffectiveModel = "free" | "ladder" | "flat" | "metered";

export function effectiveModel(e: Endpoint): EffectiveModel {
  if (e.pricing.model === "metered") return "metered";
  if (e.pricing.cost === 0) return "free";
  return e.pricing.model;
}

/** The credit band a call can land in: `[min, max]`, equal for fixed prices. */
export function costRange(e: Endpoint): { min: number; max: number } {
  if (e.pricing.model === "metered") {
    return {
      min: e.pricing.minCost ?? e.pricing.cost,
      max: e.pricing.maxCost ?? e.pricing.cost,
    };
  }
  return { min: e.pricing.cost, max: e.pricing.cost };
}

/**
 * Credits deducted the moment the request is accepted. Fixed-price endpoints
 * charge their cost; metered endpoints hold the ceiling and refund the
 * difference once the work settles. `null` where the hold is computed per
 * request from the inputs — a single number would be a fiction there.
 */
export function creditsHeldUpfront(e: Endpoint): number | null {
  if (e.pricing.holdIsComputed) return null;
  return costRange(e).max;
}

function plural(n: number): string {
  return n === 1 ? "credit" : "credits";
}

/** Human-readable seconds — "15 min", "30 days", "2 min". */
function humanDuration(seconds: number): string {
  if (seconds % 86_400 === 0) {
    const days = seconds / 86_400;
    return `${days} day${days === 1 ? "" : "s"}`;
  }
  if (seconds % 3_600 === 0) {
    const hours = seconds / 3_600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

/**
 * A short, honest pricing note for one endpoint. Metered endpoints lead with
 * the band (so the ceiling is never buried) and then carry the authored
 * wording, which is the only place a per-input carve-out can be stated — e.g.
 * `prism/comments` meters 2-200 by comment page but is a flat 5 for an
 * Instagram post URL, which no range can express.
 */
export function pricingNote(e: Endpoint): string {
  const model = effectiveModel(e);
  const authored = e.pricing.description;

  if (model === "metered") {
    const { min, max } = costRange(e);
    const band = min === max ? `${min} ${plural(min)}` : `${min}-${max} credits`;
    // Most meters hold the flat ceiling. A few compute the hold from the inputs
    // (a cohort query's ceiling is the panel size × the page cap), so quoting
    // `max` as "the amount held" would be wrong by orders of magnitude.
    const headline = e.pricing.holdIsComputed
      ? `Metered — ${band} per call; the exact ceiling is computed from the request, held up front, and refunded down to the work actually done`
      : `Metered — ${band} per call, ${max} held up front and refunded down to the work actually done`;
    return authored ? `${headline}. ${authored}` : `${headline}.`;
  }

  if (model === "free") {
    return authored ?? "Free — 0 credits.";
  }

  if (model === "flat") {
    const headline = `Flat rate — ${e.pricing.cost} ${plural(e.pricing.cost)} per call (a per-endpoint price, off the standard ${e.pricing.tier} ladder)`;
    return authored ? `${headline}. ${authored}` : `${headline}.`;
  }

  const tier = e.pricing.tier.charAt(0).toUpperCase() + e.pricing.tier.slice(1);
  const headline = `${tier} tier — ${e.pricing.cost} ${plural(e.pricing.cost)} per call`;
  return authored ? `${headline}. ${authored}` : `${headline}.`;
}

/** One-line cache note. A hit inside the window is served for 0 credits. */
export function cacheNote(e: Endpoint): string {
  if (e.cache.ttlSeconds === 0) {
    return "Not cached — every call is live and billed.";
  }
  return `Cached for ${humanDuration(e.cache.ttlSeconds)} — an identical call inside that window is a free cache hit (0 credits).`;
}

export interface EndpointPricing {
  platform: string;
  resource: string;
  method: string;
  public_path: string;
  summary: string;
  /** `free` | `ladder` | `flat` | `metered`. */
  pricing_model: EffectiveModel;
  credit_tier: string;
  /** Static cost. On a metered endpoint this is the FLOOR, not the price. */
  credit_cost: number;
  /** What this endpoint's tier alone would cost on the plain 1/5/10 ladder. */
  ladder_cost: number;
  min_credits: number;
  max_credits: number;
  /** Deducted when the request is accepted; the unused part is refunded. */
  credits_held_upfront: number | null;
  /** True when the upfront hold is computed per request, so no fixed number applies. */
  hold_is_computed: boolean;
  is_free: boolean;
  is_metered: boolean;
  is_flat_override: boolean;
  /** Fixed page size when the meter bills per page, else null. */
  metered_page_size: number | null;
  /** Exact authored wording for a dynamic price, or null. */
  pricing_description: string | null;
  pricing_note: string;
  cache_ttl_seconds: number;
  cache_note: string;
  /** Whether the Actor can follow `next_cursor` — each extra page bills again. */
  paginatable: boolean;
}

/** Full pricing payload for one endpoint. */
export function pricingFor(e: Endpoint): EndpointPricing {
  const model = effectiveModel(e);
  const { min, max } = costRange(e);
  return {
    platform: e.platform,
    resource: e.resource,
    method: e.method,
    public_path: publicPath(e),
    summary: e.summary,
    pricing_model: model,
    credit_tier: e.pricing.tier,
    credit_cost: e.pricing.cost,
    ladder_cost: e.pricing.ladderCost,
    min_credits: min,
    max_credits: max,
    credits_held_upfront: creditsHeldUpfront(e),
    hold_is_computed: e.pricing.holdIsComputed === true,
    is_free: model === "free",
    is_metered: model === "metered",
    is_flat_override: model === "flat",
    metered_page_size: e.pricing.pageSize ?? null,
    pricing_description: e.pricing.description ?? null,
    pricing_note: pricingNote(e),
    cache_ttl_seconds: e.cache.ttlSeconds,
    cache_note: cacheNote(e),
    paginatable: Boolean(e.pagination) && !e.singlePage,
  };
}

/**
 * What a run is about to cost, for the pre-flight status line and for
 * `dryRun`. `maxPages` accounts for auto-pagination: every extra page is a
 * fresh billed request.
 */
export function estimateRunCost(
  e: Endpoint,
  maxPages = 1,
): { min: number; max: number; text: string } {
  const pages = Math.max(1, maxPages);
  const { min, max } = costRange(e);
  const totalMin = min * pages;
  const totalMax = max * pages;

  const perCall =
    min === max
      ? `${min} ${plural(min)}`
      : e.pricing.holdIsComputed
        ? `${min}-${max} credits (metered — the ceiling is computed from your request, held, then refunded down to actual)`
        : `${min}-${max} credits (metered — ${max} held, refunded down to actual)`;

  if (pages === 1) return { min: totalMin, max: totalMax, text: perCall };

  const total =
    totalMin === totalMax
      ? `${totalMax} ${plural(totalMax)}`
      : `${totalMin}-${totalMax} credits`;
  return {
    min: totalMin,
    max: totalMax,
    text: `${perCall} per page × up to ${pages} pages = up to ${total}`,
  };
}

/**
 * Account-level pricing context, attached to the OUTPUT of the discovery
 * actions so a user sees the credit model, not just per-call numbers. Counts
 * and the ladder come from the generated snapshot, so they cannot drift from
 * the bundled data the way hand-typed copy does.
 */
export const PRICING_SUMMARY = {
  model:
    "Every data call is billed in credits against your own SocialCrawl API key. This Actor is free on Apify; you only pay Apify's standard compute. Each response echoes `credits_used` and `credits_remaining` (the latter is null on a cache hit, which does no ledger read).",
  ladder: {
    note: `The 1/5/10 tier ladder covers ${REGISTRY_STATS.ladderPriced} of ${REGISTRY_STATS.totalEndpoints} endpoints.`,
    tiers: [
      {
        tier: "standard",
        credits: CREDIT_LADDER.standard,
        note: "Most profile/post/comment/search endpoints, the commerce reference data (category trees, filters, store locators), and web map/parse.",
      },
      {
        tier: "advanced",
        credits: CREDIT_LADDER.advanced,
        note: "Analytics-heavy endpoints, ad libraries, the commerce product/review catalogues (Klarna, AliExpress, Sephora, Gumtree, G2, Wayfair, Etsy, H&M, Kohl's), structured web extraction, lighter composites.",
      },
      {
        tier: "premium",
        credits: CREDIT_LADDER.premium,
        note: "Video/audio transcripts (except YouTube), job-board search, LinkedIn people/jobs search and reaction lists, app-listing databases, and the heaviest single-call endpoints.",
      },
    ],
  },
  flat_overrides: {
    count: REGISTRY_STATS.flatPriced,
    note: `${REGISTRY_STATS.flatPriced} endpoints carry a per-endpoint price off the ladder — Universal Search and its fused siblings, the Content Analysis analytics, the Prism composites (1–50), the one-call profile/full dossiers, the web agent, and the free control routes. Run action "List pricing" for the exact number on each.`,
  },
  metered: {
    count: REGISTRY_STATS.meteredPriced,
    note: `${REGISTRY_STATS.meteredPriced} endpoints are METERED: the charge is computed from the params you send. The API holds the ceiling (\`max_credits\`) up front and refunds down to the work actually done, so budget against \`max_credits\` and expect to be charged less.`,
  },
  free: {
    count: REGISTRY_STATS.freeEndpoints,
    rules: [
      "New accounts start with 100 free credits (no credit card).",
      "Cache hits cost 0 credits — see each endpoint's `cache_ttl_seconds`.",
      "Idempotent replays within 24h (the `idempotencyKey` input) cost 0 new credits.",
      "Credits are auto-refunded on upstream errors, empty results, request timeouts, and circuit-breaker trips.",
      `${REGISTRY_STATS.freeEndpoints} registry endpoints never charge at all — the four utility discovery routes, prism/lookup (which charges the resolved endpoint's own price, with no routing surcharge), and the stateful web job/monitor/session control routes.`,
      "Creating, listing, pausing and deleting monitors is free; each scheduled monitor RUN bills its recipe's cost plus 1 credit.",
      "The whole cohort lifecycle is free — create, upload members, poll, cancel, delete, and read results. Only the query bills, per successful upstream page, and it refunds the unspent reservation exactly once.",
      'Action "Credit ledger" returns the receipt for every deduction and refund, keyed by request_id, for 0 credits.',
    ],
  },
  pagination_warning: `Auto-pagination (the \`maxItems\` input) makes one billed request per page. ${REGISTRY_STATS.paginatableEndpoints} endpoints support it — check \`paginatable\` before sizing a run.`,
  packs: "Paid plans start at 5,000 credits / £14 per month.",
  signup_url: SIGNUP_URL,
  billing_url: BILLING_URL,
  docs_url: DOCS_URL,
} as const;
