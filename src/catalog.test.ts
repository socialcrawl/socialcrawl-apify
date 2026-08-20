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
import { prepareMonitorBody } from "./data/monitors.js";

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
  it("covers the four commerce platforms added in the latest wave", () => {
    for (const [platform, count] of [
      ["walmart", 5],
      ["target", 5],
      ["home_depot", 2],
      ["ebay", 2],
    ] as const) {
      expect(getEndpointsByPlatform(platform), platform).toHaveLength(count);
      expect(findPlatform(platform), platform).toBeDefined();
    }
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
