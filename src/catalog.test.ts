import { describe, expect, it } from "vitest";
import {
  ALL_ENDPOINTS,
  findEndpoint,
  findEndpoints,
  findPlatform,
  getEndpointsByPlatform,
  isPaginatable,
  publicPath,
  searchEndpoints,
} from "./catalog.js";
import { prepareCohortBody } from "./data/cohorts.js";
import { prepareMonitorBody } from "./data/monitors.js";
import { PLATFORMS } from "./data/platforms.js";

describe("findEndpoint", () => {
  it("resolves a plain single-method endpoint without being told the verb", () => {
    const e = findEndpoint("tiktok", "profile");
    expect(e?.method).toBe("GET");
  });

  it("needs the method to pick between verbs sharing one resource", () => {
    const candidates = findEndpoints("web", "monitors/{monitor_id}");
    expect(candidates.length).toBeGreaterThan(1);
    expect(findEndpoint("web", "monitors/{monitor_id}", "DELETE")?.method).toBe("DELETE");
    expect(findEndpoint("web", "monitors/{monitor_id}", "PATCH")?.method).toBe("PATCH");
  });

  it("returns undefined for a verb the resource does not expose", () => {
    expect(findEndpoint("tiktok", "profile", "DELETE")).toBeUndefined();
  });
});

describe("publicPath", () => {
  it("derives /v1/{platform}/{resource} for registry endpoints", () => {
    expect(publicPath(findEndpoint("tiktok", "profile")!)).toBe("/v1/tiktok/profile");
  });

  it("honours the explicit path on the non-registry monitors family", () => {
    // `monitors/pause` is a PATCH on the monitor itself, not a /pause route.
    expect(publicPath(findEndpoint("monitors", "pause")!)).toBe("/v1/monitors/{monitor_id}");
    expect(publicPath(findEndpoint("monitors", "create")!)).toBe("/v1/monitors");
  });
});

describe("isPaginatable", () => {
  it("is true for a cursor endpoint", () => {
    expect(isPaginatable(findEndpoint("tiktok", "profile/videos")!)).toBe(true);
  });

  it("is false for a single-object endpoint", () => {
    expect(isPaginatable(findEndpoint("tiktok", "profile")!)).toBe(false);
  });

  it("is false for every endpoint declared single-page", () => {
    const singlePage = ALL_ENDPOINTS.filter((e) => e.singlePage);
    expect(singlePage.length).toBeGreaterThan(0);
    for (const e of singlePage) {
      expect(isPaginatable(e), `${e.platform}/${e.resource}`).toBe(false);
    }
  });

  it("holds the invariant the guard exists for: no endpoint is both", () => {
    // Today the registry never ships an endpoint with a cursor descriptor AND a
    // single-page declaration. If one ever appears, isPaginatable must keep
    // choosing single-page — following that cursor would re-bill for page 1.
    const both = ALL_ENDPOINTS.filter((e) => e.pagination && e.singlePage);
    expect(both.map((e) => `${e.platform}/${e.resource}`)).toEqual([]);
  });
});

describe("searchEndpoints", () => {
  it("ranks an exact platform/resource hit first", () => {
    const [first] = searchEndpoints("tiktok/profile");
    expect(`${first?.platform}/${first?.resource}`).toBe("tiktok/profile");
  });

  it("finds endpoints by what they do, not just by name", () => {
    const hits = searchEndpoints("transcript");
    expect(hits.length).toBeGreaterThan(3);
    const haystack = (e: (typeof hits)[number]): string =>
      [
        e.platform,
        e.resource,
        e.summary,
        e.description,
        ...e.params.map((p) => p.name),
        ...e.optionalParams.map((p) => p.name),
      ]
        .join(" ")
        .toLowerCase();
    expect(hits.every((e) => haystack(e).includes("transcript"))).toBe(true);
  });

  it("ANDs multiple terms", () => {
    const hits = searchEndpoints("walmart reviews");
    expect(hits.some((e) => e.platform === "walmart" && e.resource === "reviews")).toBe(true);
    expect(hits.every((e) => `${e.platform}/${e.resource} ${e.summary} ${e.description}`.toLowerCase().includes("walmart"))).toBe(true);
  });

  it("finds endpoints by parameter name", () => {
    const hits = searchEndpoints("asin");
    expect(hits.some((e) => e.platform === "amazon")).toBe(true);
  });

  it("reaches the non-registry monitors family too", () => {
    expect(searchEndpoints("monitors timeseries").some((e) => e.platform === "monitors")).toBe(true);
  });

  it("returns nothing for an empty query rather than everything", () => {
    expect(searchEndpoints("   ")).toEqual([]);
  });

  it("respects the result limit", () => {
    expect(searchEndpoints("a", 5).length).toBeLessThanOrEqual(5);
  });
});

describe("getEndpointsByPlatform", () => {
  // Pinning literal counts here made this test a chore on every registry wave
  // and told us nothing the generated data does not already know. What matters
  // is that the lookup agrees with each platform's own declared count.
  it("agrees with every platform's declared endpoint count", () => {
    for (const p of PLATFORMS) {
      expect(getEndpointsByPlatform(p.slug), p.slug).toHaveLength(p.endpointCount);
    }
  });

  it("resolves every platform slug the catalog advertises", () => {
    for (const p of PLATFORMS) {
      expect(findPlatform(p.slug), p.slug).toBeDefined();
    }
  });

  // A named spot-check, so a wave that silently dropped a whole platform is
  // caught by something more legible than an arithmetic mismatch. These are
  // the surfaces added or materially reshaped in the 2026-09-08 wave.
  it("carries the platforms added in the latest wave", () => {
    for (const slug of [
      "telegram",
      "douyin",
      "quora",
      "apple_music",
      "finance",
      "jobs",
      "us_congress_trades",
      "on_page",
      "g2",
      "wayfair",
      "etsy",
      "sephora",
      "aliexpress",
      "hm",
      "kohls",
      "klarna",
      "gumtree",
      "yelp",
    ]) {
      expect(findPlatform(slug), slug).toBeDefined();
      expect(getEndpointsByPlatform(slug).length, slug).toBeGreaterThan(0);
    }
  });

  it("no longer carries google_finance, which became the finance platform", () => {
    expect(findPlatform("google_finance")).toBeUndefined();
    expect(getEndpointsByPlatform("finance").map((e) => e.resource)).toContain("quote");
  });
});

describe("prepareCohortBody", () => {
  it("parses array fields that arrived as JSON text", () => {
    const body = prepareCohortBody({
      members: '[{"external_id":"a","platform":"instagram","handle":"natgeo"}]',
      keywords: '["acme","acme pro"]',
      platforms: '["instagram"]',
    });
    expect(body.members).toEqual([
      { external_id: "a", platform: "instagram", handle: "natgeo" },
    ]);
    expect(body.keywords).toEqual(["acme", "acme pro"]);
    expect(body.platforms).toEqual(["instagram"]);
  });

  it("coerces the integer caps a form field would submit as strings", () => {
    // The API's schemas are `.strict()` and reject "30" where 30 is required,
    // so a value typed into a text field has to be repaired before it is sent.
    const body = prepareCohortBody({
      retention_days: "30",
      max_credits: "30000",
      max_items_per_identity: "100",
      max_pages_per_identity: "3",
      limit: "500",
    });
    expect(body).toEqual({
      retention_days: 30,
      max_credits: 30000,
      max_items_per_identity: 100,
      max_pages_per_identity: 3,
      limit: 500,
    });
  });

  it("leaves unparseable text and already-structured values alone", () => {
    const members = [{ external_id: "a", platform: "tiktok", handle: "x" }];
    expect(prepareCohortBody({ keywords: "not json" }).keywords).toBe("not json");
    expect(prepareCohortBody({ members }).members).toBe(members);
    // A non-integer must survive untouched so the API explains what is wrong.
    expect(prepareCohortBody({ max_credits: "lots" }).max_credits).toBe("lots");
  });
});

describe("prepareMonitorBody", () => {
  it("passes the three cadence presets through untouched", () => {
    for (const cadence of ["hourly", "daily", "weekly"]) {
      expect(prepareMonitorBody({ cadence }).cadence).toBe(cadence);
    }
  });

  it("wraps anything else as a cron expression", () => {
    expect(prepareMonitorBody({ cadence: "0 */6 * * *" }).cadence).toEqual({
      cron: "0 */6 * * *",
    });
  });

  it("parses structured fields that arrived as JSON text", () => {
    const body = prepareMonitorBody({
      params: '{"brand":"acme"}',
      alert_rules: '[{"metric":"m","op":"gt","value":1}]',
    });
    expect(body.params).toEqual({ brand: "acme" });
    expect(body.alert_rules).toEqual([{ metric: "m", op: "gt", value: 1 }]);
  });

  it("leaves unparseable text alone so the API can explain what is wrong", () => {
    expect(prepareMonitorBody({ params: "not json" }).params).toBe("not json");
  });

  it("leaves already-structured values alone", () => {
    const rules = [{ metric: "m", op: "gt", value: 1 }];
    expect(prepareMonitorBody({ alert_rules: rules }).alert_rules).toBe(rules);
  });
});

describe("searchEndpoints uses the registry's topic tags", () => {
  it("reaches every ad library from the word people actually search", () => {
    // The tags are `tiktok-ads` / `linkedin-ads` / `facebook-ads` / `google-ads`,
    // so a segment match is what makes the bare term "ads" work. Without it the
    // top hits were Threads endpoints, which merely contain the letters.
    const top = searchEndpoints("ads", 8).map((e) => `${e.platform}/${e.resource}`);
    expect(top.some((p) => p.includes("adlibrary") || p.includes("/ads"))).toBe(true);
    expect(top.slice(0, 5).every((p) => !p.startsWith("threads/"))).toBe(true);
  });

  it("still ranks an exact path above a tag match", () => {
    expect(searchEndpoints("tiktok/profile", 1)[0]).toMatchObject({
      platform: "tiktok",
      resource: "profile",
    });
  });
});
