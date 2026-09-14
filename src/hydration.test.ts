import { describe, expect, it } from "vitest";
import { ALL_ENDPOINTS, findEndpoint, getHydratableEndpoints } from "./catalog.js";
import { REGISTRY_STATS } from "./data/stats.js";
import {
  describeJoins,
  hasRowJoin,
  includeJoins,
  joinCostImpact,
  requestedJoinTokens,
  tokenCeiling,
} from "./hydration.js";
import { costRange, costRangeForCall, estimateRunCost, pricingFor } from "./pricing.js";

/**
 * The `include=…` joins are the newest way a call's price moves and the one a
 * flat endpoint list hides completely: the same endpoint bills its plain rate
 * or up to a per-row ceiling depending on one param. These tests pin both ends
 * of that — that the catalogue reports the join honestly, and that a concrete
 * call is priced for what it actually asked for.
 */

const pinterestSearch = findEndpoint("pinterest", "search")!;
const youtubeSearch = findEndpoint("youtube", "search")!;
const igPostStats = findEndpoint("instagram", "post/stats")!;
const tiktokProfile = findEndpoint("tiktok", "profile")!;
const prismVoice = findEndpoint("prism", "voice")!;
const instagramSimilar = findEndpoint("instagram", "similar")!;
const threadsUserPosts = findEndpoint("threads", "user/posts")!;

describe("the join catalogue reads the registry rather than guessing", () => {
  it("finds the row joins the registry declares", () => {
    expect(hasRowJoin(pinterestSearch)).toBe(true);
    expect(hasRowJoin(youtubeSearch)).toBe(true);
    expect(hasRowJoin(igPostStats)).toBe(true);
    // A plain read with no `include` at all.
    expect(hasRowJoin(tiktokProfile)).toBe(false);
  });

  it("reads the single-token vocabulary off an enum param", () => {
    const [join] = includeJoins(pinterestSearch);
    expect(join).toMatchObject({
      param: "include",
      kind: "row-join",
      tokens: ["engagement"],
      maxTokens: 1,
      appliesTo: "each row",
    });
  });

  it("reads the multi-token vocabulary off the CSV constraint", () => {
    const [join] = includeJoins(youtubeSearch);
    expect(join!.tokens).toEqual(["engagement", "channel"]);
    expect(join!.maxTokens).toBe(2);
  });

  it("knows a join that fills one object rather than a list of rows", () => {
    const [join] = includeJoins(igPostStats);
    expect(join!.tokens).toEqual(["saves"]);
    expect(join!.appliesTo).toBe("the response");
  });

  it("marks the legacy spelling as an alias of the canonical token", () => {
    const joins = includeJoins(findEndpoint("threads", "search/users")!);
    const alias = joins.find((j) => j.param === "include_details");
    expect(alias?.alias).toBe(true);
    expect(joins.find((j) => j.param === "include")?.alias).toBe(false);
  });

  it("does not mistake a free-form section selector for a billed row join", () => {
    // `prism/voice` takes an `include` that picks response blocks on a flat
    // price. Calling that a row join would invent a charge that never happens.
    const joins = includeJoins(prismVoice);
    expect(joins.length).toBeGreaterThan(0);
    expect(joins.every((j) => j.kind === "section-select")).toBe(true);
    expect(hasRowJoin(prismVoice)).toBe(false);
  });

  it("derives the extra-credit ceiling from the endpoint's own band", () => {
    const [join] = includeJoins(pinterestSearch);
    expect(join!.extraCreditsMax).toBe(
      (pinterestSearch.pricing.maxCost ?? 0) - pinterestSearch.pricing.cost,
    );
  });

  it("agrees with the generated stats on how many endpoints take an include", () => {
    const withAnyInclude = ALL_ENDPOINTS.filter(
      (e) => e.nonRegistry !== true && includeJoins(e).length > 0,
    );
    expect(withAnyInclude).toHaveLength(REGISTRY_STATS.hydratableEndpoints);
  });

  it("agrees with the generated stats on how many joins are actually billed", () => {
    // 28 endpoints declare a join; 60 take an `include` param of some kind.
    // Every piece of pricing copy quotes the smaller one — swapping them would
    // overstate the billed surface more than twofold.
    const billed = ALL_ENDPOINTS.filter((e) => e.nonRegistry !== true && hasRowJoin(e));
    expect(billed).toHaveLength(REGISTRY_STATS.rowJoinEndpoints);
    expect(REGISTRY_STATS.rowJoinEndpoints).toBeLessThan(
      REGISTRY_STATS.hydratableEndpoints,
    );
    const tokens = billed.reduce((n, e) => n + (e.hydration?.length ?? 0), 0);
    expect(tokens).toBe(REGISTRY_STATS.rowJoinTokens);
  });

  it("does not treat a per-thread meter as a row join", () => {
    // reddit/omni-search meters per thread EXPANDED, not per row joined, and
    // its `include` picks response blocks. The heuristic this replaced called
    // it a join; the registry does not, and the registry is right.
    const omni = findEndpoint("reddit", "omni-search")!;
    expect(hasRowJoin(omni)).toBe(false);
    expect(includeJoins(omni).every((j) => j.kind === "section-select")).toBe(true);
  });

  it("carries a complete declaration for every join token", () => {
    for (const e of getHydratableEndpoints()) {
      for (const h of e.hydration ?? []) {
        const key = `${e.platform}/${e.resource} :: ${h.token}`;
        expect(h.param, key).toBe("include");
        expect(h.sibling, key).toMatch(/^[a-z_]+\/\S+$/);
        expect(h.fills.length, key).toBeGreaterThan(0);
        expect(h.creditsPerItem, key).toBeGreaterThan(0);
        expect(h.maxItems, key).toBeGreaterThan(0);
        // Every declared token must be one the param actually accepts, or a
        // caller following the catalogue would get a 400.
        const vocab = includeJoins(e).find((j) => j.param === h.param)?.tokens;
        expect(vocab, key).toContain(h.token);
      }
    }
  });

  it("names a sibling that is a real endpoint in this catalog", () => {
    for (const e of getHydratableEndpoints()) {
      for (const h of e.hydration ?? []) {
        const slash = h.sibling.indexOf("/");
        const sibling = findEndpoint(
          h.sibling.slice(0, slash),
          h.sibling.slice(slash + 1),
          h.siblingMethod as "GET" | "POST" | undefined,
        );
        expect(sibling, `${e.platform}/${e.resource} -> ${h.sibling}`).toBeDefined();
      }
    }
  });

  it("keeps each token's declared ceiling within the endpoint's band", () => {
    // The sum of the joins can be less than the band (other metering), but it
    // can never exceed it — that would mean quoting a charge the API cannot make.
    for (const e of getHydratableEndpoints()) {
      const sum = (e.hydration ?? []).reduce((n, h) => n + tokenCeiling(h), 0);
      const band = (e.pricing.maxCost ?? e.pricing.cost) - e.pricing.cost;
      expect(sum, `${e.platform}/${e.resource}`).toBeLessThanOrEqual(band);
    }
  });

  it("keeps every row join's ceiling above its plain price", () => {
    for (const e of getHydratableEndpoints()) {
      const key = `${e.platform}/${e.resource}`;
      expect(costRange(e).max, key).toBeGreaterThan(e.pricing.cost);
    }
  });

  it("gives every declared join real prose to explain itself", () => {
    for (const e of getHydratableEndpoints()) {
      for (const j of includeJoins(e)) {
        expect(j.description.length, `${e.platform}/${e.resource} :: ${j.param}`)
          .toBeGreaterThan(20);
      }
    }
  });

  it("returns null rather than an empty list for an endpoint with no join", () => {
    expect(describeJoins(tiktokProfile)).toBeNull();
    expect(describeJoins(pinterestSearch)).not.toBeNull();
  });
});

describe("reading the join out of a concrete request", () => {
  it("picks up a single token", () => {
    expect(requestedJoinTokens({ include: "engagement" })).toEqual([
      { param: "include", tokens: ["engagement"] },
    ]);
  });

  it("splits and trims a CSV of tokens", () => {
    expect(requestedJoinTokens({ include: "engagement, channel" })).toEqual([
      { param: "include", tokens: ["engagement", "channel"] },
    ]);
  });

  it("treats the boolean alias as on only when it is true", () => {
    expect(requestedJoinTokens({ include_details: true })).toHaveLength(1);
    expect(requestedJoinTokens({ include_details: false })).toHaveLength(0);
    // The same thing arriving as a string through a JSON form field.
    expect(requestedJoinTokens({ include_details: "false" })).toHaveLength(0);
  });

  it("ignores an absent or empty include", () => {
    expect(requestedJoinTokens({})).toHaveLength(0);
    expect(requestedJoinTokens({ include: "" })).toHaveLength(0);
  });
});

describe("a call is priced for what it actually asked for", () => {
  it("prices a plain call at the plain rate, not the joined ceiling", () => {
    // The endpoint band is 1-26; the call is 1. Quoting 26 here would tell
    // someone a search costs 26x what it does.
    expect(costRange(pinterestSearch)).toEqual({ min: 1, max: 26 });
    expect(costRangeForCall(pinterestSearch, { query: "chairs" })).toEqual({
      min: 1,
      max: 1,
    });
  });

  it("prices a joined call at the full band", () => {
    expect(
      costRangeForCall(pinterestSearch, { query: "chairs", include: "engagement" }),
    ).toEqual({ min: 1, max: 26 });
  });

  it("keeps the full band on a meter the join does not explain", () => {
    // web/crawl is metered by pages crawled and has no join at all — narrowing
    // it to its floor would under-quote a 10,000-page crawl by four orders.
    const crawl = findEndpoint("web", "crawl")!;
    expect(costRangeForCall(crawl, { url: "https://example.com" })).toEqual(
      costRange(crawl),
    );
  });

  it("names the join in the estimate when one is requested", () => {
    const withJoin = estimateRunCost(pinterestSearch, 1, { include: "engagement" });
    expect(withJoin.max).toBe(26);
    expect(withJoin.text).toContain("engagement");

    const plain = estimateRunCost(pinterestSearch, 1, {});
    expect(plain.max).toBe(1);
    expect(plain.text).not.toContain("engagement");
  });

  it("multiplies the joined ceiling across auto-paginated pages", () => {
    const est = estimateRunCost(pinterestSearch, 4, { include: "engagement" });
    expect(est.max).toBe(26 * 4);
  });

  it("reports the impact of a join it was asked for", () => {
    const impact = joinCostImpact(pinterestSearch, { include: "engagement" });
    expect(impact.requested).toBe(true);
    expect(impact.extraCreditsMax).toBe(25);
    expect(impact.note).toContain("25");
  });

  it("reports no impact when the endpoint offers no billed join", () => {
    expect(joinCostImpact(tiktokProfile, { include: "engagement" })).toMatchObject({
      requested: false,
      extraCreditsMax: 0,
      note: null,
    });
  });

  it("takes the ceiling, not the sum, when several tokens are sent", () => {
    // The registry prices the CALL. Summing per token would double-count.
    const impact = joinCostImpact(youtubeSearch, { include: "engagement,channel" });
    expect(impact.extraCreditsMax).toBe(
      (youtubeSearch.pricing.maxCost ?? 0) - youtubeSearch.pricing.cost,
    );
  });
});

describe("the pricing payload carries the join", () => {
  it("separates the plain price from the joined ceiling", () => {
    const p = pricingFor(pinterestSearch);
    expect(p.has_row_join).toBe(true);
    expect(p.credit_cost).toBe(1);
    expect(p.max_credits).toBe(26);
    expect(p.row_join_extra_credits_max).toBe(25);
    expect(p.row_joins).toHaveLength(1);
  });

  it("says in words which end of the band is which", () => {
    expect(pricingFor(pinterestSearch).pricing_note).toContain("A plain call is 1 credit");
  });

  it("leaves the join fields empty on an endpoint without one", () => {
    const p = pricingFor(tiktokProfile);
    expect(p.has_row_join).toBe(false);
    expect(p.row_join_extra_credits_max).toBe(0);
    expect(p.row_joins).toBeNull();
  });
});

describe("a call is priced from the registry's per-token declarations", () => {
  it("lowers the ceiling when the caller asks for fewer rows", () => {
    // pinterest/search declares creditsPerItem 1, maxItems 25, rowLimitParam
    // "limit". limit=10 therefore means 11 credits, not 26.
    expect(costRangeForCall(pinterestSearch, { query: "x", include: "engagement", limit: 10 }))
      .toEqual({ min: 1, max: 11 });
  });

  it("says in the note why the ceiling came down", () => {
    const impact = joinCostImpact(pinterestSearch, { include: "engagement", limit: 10 });
    expect(impact.extraCreditsMax).toBe(10);
    expect(impact.note).toContain("limit=10");
    expect(impact.note).toContain("25");
  });

  it("never raises the ceiling above the declared cap", () => {
    expect(
      costRangeForCall(pinterestSearch, { include: "engagement", limit: 999 }),
    ).toEqual({ min: 1, max: 26 });
  });

  it("ignores a row limit that is not a usable number", () => {
    for (const limit of ["", "abc", 0, -5]) {
      expect(
        costRangeForCall(pinterestSearch, { include: "engagement", limit }).max,
        String(limit),
      ).toBe(26);
    }
  });

  it("charges only for the tokens actually asked for", () => {
    // youtube/search offers two joins at a 5-credit batch cap each. Asking for
    // one and being quoted both overstates the call by half — which is what the
    // old `maxCost - cost` arithmetic did.
    expect(costRangeForCall(youtubeSearch, { include: "engagement" })).toEqual({
      min: 1,
      max: 6,
    });
    expect(costRangeForCall(youtubeSearch, { include: "engagement,channel" })).toEqual({
      min: 1,
      max: 11,
    });
  });

  it("does not let a row limit lower a batched join", () => {
    // A batch bills a flat cap for the whole call, so `limit` is not the lever
    // here and pretending otherwise would under-quote.
    expect(costRangeForCall(youtubeSearch, { include: "engagement", limit: 2 })).toEqual({
      min: 1,
      max: 6,
    });
  });

  it("uses the declared default row count when no limit is sent", () => {
    // instagram/similar joins its top 20 by default but will join 80 on
    // request, so the same token costs 20 or 80 depending on `limit`.
    expect(costRangeForCall(instagramSimilar, { include: "profile" })).toEqual({
      min: 5,
      max: 25,
    });
    expect(costRangeForCall(instagramSimilar, { include: "profile", limit: 80 })).toEqual({
      min: 5,
      max: 85,
    });
  });

  it("keeps the metering a join does NOT explain", () => {
    // threads/user/posts is 1-165: 15 of that is the join, the rest is a wide
    // `limit` reading a second source. Flattening a plain call to its floor —
    // which the old arithmetic did — promised 1 credit on a call that can bill
    // 150.
    const plain = costRangeForCall(threadsUserPosts, {});
    expect(plain).toEqual({ min: 1, max: 150 });
    expect(costRangeForCall(threadsUserPosts, { include: "engagement" })).toEqual({
      min: 1,
      max: 165,
    });
  });

  it("does not apply a row limit to a call with no join", () => {
    expect(costRangeForCall(pinterestSearch, { query: "x", limit: 10 })).toEqual({
      min: 1,
      max: 1,
    });
  });
});
