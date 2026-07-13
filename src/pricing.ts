import type { Endpoint } from "./types.js";
import { BILLING_URL } from "./constants.js";

/** Base credit rate for each tier (the standard/advanced/premium ladder). */
const LADDER: Record<Endpoint["creditTier"], number> = {
  standard: 1,
  advanced: 5,
  premium: 10,
};

/**
 * A short, human-readable pricing note for one endpoint. Distinguishes the
 * three normal tiers from the flat-rate overrides that sit outside the
 * 1/5/10 ladder (Universal Search, Content Analysis, Prism composites, the
 * web agent, YouTube transcripts, …) and from the free (0-credit) stateful
 * job/session/monitor control routes.
 */
export function pricingNote(e: Endpoint): string {
  if (e.creditCost === 0) {
    return "Free — 0 credits (no charge; stateful job/session/monitor control)";
  }
  if (LADDER[e.creditTier] === e.creditCost) {
    const unit = e.creditCost === 1 ? "credit" : "credits";
    const tier = e.creditTier.charAt(0).toUpperCase() + e.creditTier.slice(1);
    return `${tier} tier — ${e.creditCost} ${unit} per call`;
  }
  return `Flat rate — ${e.creditCost} credits per call (outside the standard ${e.creditTier} ladder)`;
}

/**
 * Full pricing payload for one endpoint — everything a caller needs to
 * reason about cost before spending a credit.
 */
export function pricingFor(e: Endpoint): {
  platform: string;
  resource: string;
  method: string;
  public_path: string;
  credit_tier: string;
  credit_cost: number;
  is_free: boolean;
  is_flat_override: boolean;
  pricing_note: string;
} {
  return {
    platform: e.platform,
    resource: e.resource,
    method: e.method,
    public_path: `/v1/${e.platform}/${e.resource}`,
    credit_tier: e.creditTier,
    credit_cost: e.creditCost,
    is_free: e.creditCost === 0,
    is_flat_override: e.creditCost !== 0 && LADDER[e.creditTier] !== e.creditCost,
    pricing_note: pricingNote(e),
  };
}

/**
 * Account-level pricing context, attached to the OUTPUT of the pricing/list
 * actions so users see the credit model, not just per-call numbers.
 */
export const PRICING_SUMMARY = {
  model:
    "Every data call is billed in credits against your own SocialCrawl API key. Cost is shown as `credit_cost` per endpoint and echoed as `credits_used` / `credits_remaining` on every response.",
  tiers: [
    { tier: "standard", credits: 1, note: "Most profile/post/comment/search endpoints, and web scrape/map/crawl/batch-scrape/parse." },
    { tier: "advanced", credits: 5, note: "Analytics-heavy endpoints, ad libraries, structured web extraction, and lighter composites." },
    { tier: "premium", credits: 10, note: "Video/audio transcripts (except YouTube), age-gender detection, and the heaviest composites." },
  ],
  flat_overrides: [
    { what: "Universal Search (search/everywhere, search/forums)", credits: 20 },
    { what: "Content Analysis analytic endpoints (search, summary, sentiment, rating-distribution, phrase-trends, category-trends)", credits: 20 },
    { what: "YouTube video transcript", credits: 3 },
    { what: "Web agent (web/agent)", credits: 25 },
    { what: "Prism composites", credits: "5–50 depending on the recipe (see each endpoint's credit_cost)" },
  ],
  free: [
    "New accounts start with 100 free credits (no credit card).",
    "Cache hits and idempotent replays (within 24h) cost 0 credits.",
    "Credits are auto-refunded on upstream errors, empty results, and circuit-breaker trips.",
    "Stateful web job/session/monitor control routes (list/get/cancel/delete) are 0 credits — you only pay for the work-producing create call.",
  ],
  packs: "Paid plans start at 5,000 credits / £14 per month.",
  billing_url: BILLING_URL,
} as const;
