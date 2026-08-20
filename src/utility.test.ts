import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ALL_ENDPOINTS, findEndpoint, publicPath } from "./catalog.js";
import { callUtility, compareCatalog, summarizeDrift, type CatalogRow } from "./utility.js";
import type { ClientConfig } from "./client.js";
import type { Endpoint } from "./types.js";

const config: ClientConfig = { apiKey: "sc_test", baseUrl: "https://api.test" };

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function envelope(data: unknown, creditsUsed = 0): string {
  return JSON.stringify({
    success: true,
    platform: "utility",
    endpoint: "/v1/utility/quickstart",
    data,
    credits_used: creditsUsed,
    credits_remaining: 100,
    request_id: "req-1",
    cached: false,
  });
}

/** Build the live catalog row the API would emit for a bundled endpoint. */
function rowFor(e: Endpoint, overrides: Partial<CatalogRow> = {}): CatalogRow {
  return {
    id: `${e.platform}/${e.resource}`,
    path: publicPath(e),
    method: e.method,
    platform: e.platform,
    resource: e.resource,
    summary: e.summary,
    credits: e.pricing.cost,
    credits_label: `${e.pricing.cost} (${e.pricing.tier})`,
    archetype: e.archetype,
    required_params: e.params.map((p) => p.name),
    one_of: e.oneOfGroups,
    optional_params: e.optionalParams.map((p) => p.name),
    paginated: Boolean(e.pagination),
    how_to_use: `/v1/utility/endpoint?id=${e.platform}/${e.resource}`,
    docs_url: `https://www.socialcrawl.dev/platforms/${e.platform}/${e.resource}`,
    ...overrides,
  };
}

describe("callUtility", () => {
  it("calls /v1/utility/{resource} and unwraps the data payload", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => envelope({ kind: "quickstart", base_url: "https://x/v1" }),
    });

    const r = await callUtility(config, "quickstart");

    expect(r.ok).toBe(true);
    expect(r.path).toBe("/v1/utility/quickstart");
    expect(r.data).toMatchObject({ kind: "quickstart" });
    expect(r.envelope?.credits_used).toBe(0);
  });

  it("forwards filters as query params", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => envelope({ kind: "agent_context" }),
    });

    await callUtility(config, "llms", { platform: "tiktok", format: "markdown" });

    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("/v1/utility/llms");
    expect(url).toContain("platform=tiktok");
    expect(url).toContain("format=markdown");
  });

  it("returns an actionable message instead of throwing on an error", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () =>
        JSON.stringify({ error: { type: "INVALID_API_KEY", message: "nope" } }),
    });

    const r = await callUtility(config, "quickstart");

    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.errorMessage).toMatch(/API key/i);
  });
});

describe("compareCatalog", () => {
  const tiktokProfile = findEndpoint("tiktok", "profile")!;
  const tiktokVideos = findEndpoint("tiktok", "profile/videos")!;
  const registryBundled = ALL_ENDPOINTS.filter((e) => !e.nonRegistry);

  it("reports in-sync when the live catalog matches the bundle exactly", () => {
    const live = registryBundled.map((e) => rowFor(e));
    const report = compareCatalog(live);

    expect(report.in_sync).toBe(true);
    expect(report.findings).toEqual([]);
    expect(report.api_endpoints).toBe(live.length);
    expect(report.actor_endpoints).toBe(registryBundled.length);
  });

  it("does NOT count the non-registry monitors family as drift", () => {
    // `utility/endpoints` never lists monitors, so counting them would report
    // permanent phantom drift on every single run.
    const live = registryBundled.map((e) => rowFor(e));
    const report = compareCatalog(live, ALL_ENDPOINTS);

    expect(report.in_sync).toBe(true);
    expect(report.findings.some((f) => f.id.startsWith("monitors/"))).toBe(false);
  });

  it("flags an endpoint the API has that this Actor does not know about", () => {
    const live = [
      ...registryBundled.map((e) => rowFor(e)),
      rowFor(tiktokProfile, {
        id: "newplatform/thing",
        path: "/v1/newplatform/thing",
        platform: "newplatform",
        resource: "thing",
        summary: "A brand new endpoint",
      }),
    ];
    const report = compareCatalog(live);

    expect(report.in_sync).toBe(false);
    expect(report.totals.missing_from_actor).toBe(1);
    const finding = report.findings.find((f) => f.kind === "missing_from_actor")!;
    expect(finding.id).toBe("newplatform/thing");
    expect(finding.actor).toBeNull();
    expect(finding.detail).toMatch(/Regenerate/i);
  });

  it("flags an endpoint this Actor lists that the API has withdrawn", () => {
    const live = registryBundled
      .filter((e) => e !== tiktokVideos)
      .map((e) => rowFor(e));
    const report = compareCatalog(live);

    expect(report.totals.missing_from_api).toBe(1);
    const finding = report.findings.find((f) => f.kind === "missing_from_api")!;
    expect(finding.id).toBe("tiktok/profile/videos");
    expect(finding.api).toBeNull();
    expect(finding.detail).toMatch(/404/);
  });

  it("flags a repriced endpoint and quotes both numbers", () => {
    const live = registryBundled.map((e) =>
      e === tiktokProfile
        ? rowFor(e, { credits: 5, credits_label: "5 (advanced)" })
        : rowFor(e),
    );
    const report = compareCatalog(live);

    expect(report.totals.cost_changed).toBe(1);
    const finding = report.findings.find((f) => f.kind === "cost_changed")!;
    expect(finding.id).toBe("tiktok/profile");
    expect(finding.api).toBe("5 (advanced)");
    expect(finding.actor).toBe(String(tiktokProfile.pricing.cost));
  });

  it("flags added or removed parameters", () => {
    const live = registryBundled.map((e) =>
      e === tiktokProfile
        ? rowFor(e, {
            optional_params: [...e.optionalParams.map((p) => p.name), "brand_new_param"],
          })
        : rowFor(e),
    );
    const report = compareCatalog(live);

    expect(report.totals.params_changed).toBe(1);
    const finding = report.findings.find((f) => f.kind === "params_changed")!;
    expect(finding.api).toContain("brand_new_param");
    expect(finding.actor).not.toContain("brand_new_param");
  });

  it("flags a change in pagination support", () => {
    const live = registryBundled.map((e) =>
      e === tiktokProfile ? rowFor(e, { paginated: true }) : rowFor(e),
    );
    const report = compareCatalog(live);

    expect(report.totals.pagination_changed).toBe(1);
  });

  it("ignores param ORDER — only membership matters", () => {
    const live = registryBundled.map((e) =>
      e === tiktokProfile
        ? rowFor(e, {
            optional_params: [...e.optionalParams.map((p) => p.name)].reverse(),
          })
        : rowFor(e),
    );
    expect(compareCatalog(live).in_sync).toBe(true);
  });

  it("keys on method, so one resource under two verbs is compared per verb", () => {
    const patch = findEndpoint("web", "monitors/{monitor_id}", "PATCH")!;
    const live = registryBundled
      .filter((e) => e !== patch)
      .map((e) => rowFor(e));
    const report = compareCatalog(live);

    const finding = report.findings.find((f) => f.kind === "missing_from_api")!;
    expect(finding.method).toBe("PATCH");
    expect(finding.id).toBe("web/monitors/{monitor_id}");
    // The GET and DELETE siblings are still matched, so they raise nothing.
    expect(report.totals.missing_from_api).toBe(1);
  });
});

describe("summarizeDrift", () => {
  it("says so plainly when everything matches", () => {
    const report = compareCatalog(
      ALL_ENDPOINTS.filter((e) => !e.nonRegistry).map((e) => rowFor(e)),
    );
    expect(summarizeDrift(report)).toMatch(/^In sync/);
  });

  it("counts each kind of difference and points at the API as authoritative", () => {
    const bundled = ALL_ENDPOINTS.filter((e) => !e.nonRegistry);
    const tiktokProfile = findEndpoint("tiktok", "profile")!;
    const live = bundled
      .filter((e) => e.resource !== "profile/videos" || e.platform !== "tiktok")
      .map((e) =>
        e === tiktokProfile ? rowFor(e, { credits: 99 }) : rowFor(e),
      );

    const text = summarizeDrift(compareCatalog(live));
    expect(text).toMatch(/^Out of date/);
    expect(text).toMatch(/1 withdrawn/);
    expect(text).toMatch(/1 repriced/);
    expect(text).toMatch(/live API is authoritative/);
  });
});
