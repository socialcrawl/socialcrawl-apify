import { describe, expect, it } from "vitest";
import { findEndpoint } from "./catalog.js";
import {
  cacheNote,
  costRange,
  creditsHeldUpfront,
  effectiveModel,
  estimateRunCost,
  PRICING_SUMMARY,
  pricingFor,
  pricingNote,
} from "./pricing.js";
import type { Endpoint, Pricing } from "./types.js";

function ep(pricing: Partial<Pricing>, partial: Partial<Endpoint> = {}): Endpoint {
  const merged: Pricing = {
    cost: 1,
    tier: "standard",
    ladderCost: 1,
    model: "ladder",
    ...pricing,
  };
  return {
    platform: "x",
    resource: "y",
    method: "GET",
    params: [],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: merged.tier,
    creditCost: merged.cost,
    pricing: merged,
    archetype: "Post",
    summary: "",
    description: "",
    cache: { category: "post", ttlSeconds: 600 },
    ...partial,
  };
}

describe("effectiveModel", () => {
  it("separates the four billing shapes", () => {
    expect(effectiveModel(ep({ model: "ladder", cost: 5, tier: "advanced" }))).toBe("ladder");
    expect(effectiveModel(ep({ model: "flat", cost: 20 }))).toBe("flat");
    expect(effectiveModel(ep({ model: "metered", cost: 1, minCost: 2, maxCost: 200 }))).toBe(
      "metered",
    );
    expect(effectiveModel(ep({ model: "flat", cost: 0 }))).toBe("free");
  });

  it("keeps a 0-cost metered endpoint metered, not free", () => {
    expect(effectiveModel(ep({ model: "metered", cost: 0, minCost: 0, maxCost: 10 }))).toBe(
      "metered",
    );
  });
});

describe("costRange / creditsHeldUpfront", () => {
  it("collapses to a point for fixed prices", () => {
    expect(costRange(ep({ model: "ladder", cost: 5, tier: "advanced" }))).toEqual({
      min: 5,
      max: 5,
    });
    expect(creditsHeldUpfront(ep({ model: "flat", cost: 20 }))).toBe(20);
  });

  it("reports the metered band, not the base cost", () => {
    const metered = ep({ model: "metered", cost: 1, minCost: 2, maxCost: 200 });
    expect(costRange(metered)).toEqual({ min: 2, max: 200 });
    // The ceiling is what actually leaves the balance when the call is accepted.
    expect(creditsHeldUpfront(metered)).toBe(200);
  });
});

describe("pricingNote", () => {
  it("labels the three ladder tiers", () => {
    expect(pricingNote(ep({ tier: "standard", cost: 1 }))).toMatch(/Standard tier — 1 credit\b/);
    expect(pricingNote(ep({ tier: "advanced", cost: 5 }))).toMatch(/Advanced tier — 5 credits/);
    expect(pricingNote(ep({ tier: "premium", cost: 10 }))).toMatch(/Premium tier — 10 credits/);
  });

  it("flags flat-rate overrides off the ladder", () => {
    expect(pricingNote(ep({ model: "flat", tier: "advanced", cost: 20 }))).toMatch(
      /Flat rate — 20 credits/,
    );
  });

  it("leads a metered endpoint with the band and the upfront hold", () => {
    const note = pricingNote(ep({ model: "metered", cost: 1, minCost: 2, maxCost: 200 }));
    expect(note).toMatch(/Metered — 2-200 credits/);
    expect(note).toMatch(/200 held up front/);
  });

  it("keeps the authored wording, which carries carve-outs a range cannot", () => {
    const note = pricingNote(
      ep({
        model: "metered",
        cost: 1,
        minCost: 2,
        maxCost: 200,
        description: "1 credit per comment page scanned, except on Instagram",
      }),
    );
    expect(note).toMatch(/2-200 credits/);
    expect(note).toMatch(/except on Instagram/);
  });

  it("calls out the free (0-credit) routes", () => {
    expect(pricingNote(ep({ model: "flat", cost: 0 }))).toMatch(/Free — 0 credits/);
  });
});

describe("cacheNote", () => {
  it("says a repeat call inside the window is free", () => {
    expect(cacheNote(ep({}, { cache: { category: "profile", ttlSeconds: 900 } }))).toMatch(
      /Cached for 15 min.*0 credits/,
    );
  });

  it("says so when an endpoint is never cached", () => {
    expect(cacheNote(ep({}, { cache: { category: "search", ttlSeconds: 0 } }))).toMatch(
      /Not cached/,
    );
  });
});

describe("estimateRunCost", () => {
  it("multiplies a fixed price by the page budget", () => {
    const e = estimateRunCost(ep({ model: "ladder", cost: 5, tier: "advanced" }), 4);
    expect(e).toMatchObject({ min: 20, max: 20 });
    expect(e.text).toMatch(/up to 4 pages/);
  });

  it("carries the metered band through the page budget", () => {
    const e = estimateRunCost(ep({ model: "metered", cost: 1, minCost: 2, maxCost: 6 }), 3);
    expect(e).toMatchObject({ min: 6, max: 18 });
  });

  it("reports a single call plainly", () => {
    expect(estimateRunCost(ep({ cost: 1 }), 1).text).toBe("1 credit");
  });
});

describe("pricingFor over the real bundled registry", () => {
  it("quotes the metered band for prism/comments, never its 1-credit base", () => {
    const e = findEndpoint("prism", "comments");
    expect(e).toBeDefined();
    const row = pricingFor(e!);
    expect(row.is_metered).toBe(true);
    expect(row.min_credits).toBe(2);
    expect(row.max_credits).toBe(200);
    expect(row.credits_held_upfront).toBe(200);
    // The base cost must not be mistaken for the price.
    expect(row.credit_cost).toBeLessThan(row.max_credits);
    expect(row.pricing_description).toMatch(/Instagram/);
  });

  it("prices Universal Search as a flat override", () => {
    const row = pricingFor(findEndpoint("search", "everywhere")!);
    expect(row.pricing_model).toBe("flat");
    expect(row.credit_cost).toBe(20);
    expect(row.min_credits).toBe(20);
    expect(row.max_credits).toBe(20);
  });

  it("prices a plain ladder endpoint at its tier rate", () => {
    const row = pricingFor(findEndpoint("tiktok", "profile")!);
    expect(row.pricing_model).toBe("ladder");
    expect(row.credit_cost).toBe(1);
    expect(row.credit_tier).toBe("standard");
    expect(row.cache_ttl_seconds).toBeGreaterThan(0);
  });

  it("marks the free stateful control routes", () => {
    const row = pricingFor(findEndpoint("web", "jobs")!);
    expect(row.is_free).toBe(true);
    expect(row.max_credits).toBe(0);
  });

  it("marks every monitors operation free", () => {
    for (const resource of ["create", "list", "get", "runs", "timeseries", "pause", "resume", "delete"]) {
      const row = pricingFor(findEndpoint("monitors", resource)!);
      expect(row.is_free, resource).toBe(true);
      expect(row.pricing_note, resource).toMatch(/plus 1 credit/);
    }
  });
});

describe("PRICING_SUMMARY", () => {
  it("reads its counts from the generated snapshot, not hand-typed copy", () => {
    expect(PRICING_SUMMARY.metered.count).toBeGreaterThan(0);
    expect(PRICING_SUMMARY.metered.note).toContain(String(PRICING_SUMMARY.metered.count));
    expect(PRICING_SUMMARY.ladder.tiers.map((t) => t.credits)).toEqual([1, 5, 10]);
  });

  it("warns that auto-pagination bills per page", () => {
    expect(PRICING_SUMMARY.pagination_warning).toMatch(/one billed request per page/);
  });
});
