import { describe, it, expect } from "vitest";
import { findEndpoint } from "./catalog.js";
import { callApi } from "./client.js";
import { runPaginated } from "./paginate.js";
import { callUtility, compareCatalog, summarizeDrift, type EndpointCatalog } from "./utility.js";
import { DEFAULT_BASE_URL } from "./constants.js";
import type { SocialCrawlSuccessResponse } from "./types.js";

/**
 * LIVE smoke test against the real SocialCrawl API. Skipped automatically when
 * SOCIALCRAWL_API_KEY is not present (e.g. plain CI), so the unit suite stays
 * hermetic. Run it with the key loaded:
 *
 *   SOCIALCRAWL_API_KEY=sc_xxx npx vitest run src/integration.test.ts
 *
 * In this repo we load it from the backend's apps/web/.env TOOLS_API_KEY — see
 * docs/features/external-integrations/APIFY-ACTOR.md §5. No mocks here on purpose.
 */
const apiKey = process.env.SOCIALCRAWL_API_KEY ?? "";
const live = apiKey ? describe : describe.skip;

live("live SocialCrawl API", () => {
  const config = { apiKey, baseUrl: DEFAULT_BASE_URL };

  it("fetches a TikTok profile and bills it correctly", async () => {
    const r = await callApi(config, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio" },
    });

    expect(r.ok).toBe(true);
    const env = r.json as SocialCrawlSuccessResponse;
    expect(env.success).toBe(true);
    expect(env.platform).toBe("tiktok");
    // A profile is cached for 15 minutes and a hit inside that window is FREE,
    // so "charges >= 1" only holds on a cold cache — running the suite twice in
    // a quarter of an hour used to turn this red for doing exactly the right
    // thing. Assert the rule the API actually promises instead.
    if (env.cached) {
      // A cache hit does no ledger read at all, so it reports no balance
      // either — echoing a stale number would be worse than saying nothing.
      expect(env.credits_used).toBe(0);
      expect(env.credits_remaining).toBeNull();
    } else {
      expect(env.credits_used).toBeGreaterThanOrEqual(1);
      expect(typeof env.credits_remaining).toBe("number");
    }
    expect(env.request_id).toBeTruthy();
    expect(env.data).toBeTruthy();
  }, 60_000);

  it("reads the credit balance for free (meta endpoint, 0 credits)", async () => {
    const r = await callApi(config, { platform: "meta", resource: "credits/balance" });
    expect(r.ok).toBe(true);
    const env = r.json as SocialCrawlSuccessResponse;
    const data = env.data as { balance?: number };
    expect(typeof data.balance).toBe("number");
  }, 30_000);

  it("returns a clean error (not a throw) for an unknown upstream resource", async () => {
    const r = await callApi(config, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "this-handle-almost-certainly-does-not-exist-xyz-9090909" },
    });
    // Either a valid (possibly empty) success envelope or a structured error —
    // never a thrown exception. The Actor must always exit cleanly.
    expect([true, false]).toContain(r.ok);
    if (!r.ok) expect(r.errorMessage).toBeTruthy();
  }, 60_000);
  it("lists monitors — the non-registry family, free, via its explicit path", async () => {
    const e = findEndpoint("monitors", "list")!;
    const r = await callApi(config, {
      platform: e.platform,
      resource: e.resource,
      path: e.path,
      method: e.method,
    });
    expect(r.ok).toBe(true);
    expect(r.path).toBe("/v1/monitors");
  }, 30_000);

  it("auto-paginates a cursor endpoint, billing once per page", async () => {
    const e = findEndpoint("tiktok", "profile/videos")!;
    const pages: number[] = [];

    const summary = await runPaginated(
      config,
      e,
      { handle: "charlidamelio" },
      {
        maxItems: 25,
        maxPages: 3,
        onPage: async (p) => {
          pages.push(p.itemCount);
        },
      },
    );

    expect(summary.pages).toBeGreaterThanOrEqual(1);
    expect(summary.pages).toBeLessThanOrEqual(3);
    expect(pages).toHaveLength(summary.pages);
    // One billed request per page (a cache hit legitimately charges 0).
    expect(summary.creditsUsed).toBeLessThanOrEqual(summary.pages);
  }, 180_000);

  it("prices the free utility discovery endpoints at 0 credits", async () => {
    const r = await callApi(config, { platform: "utility", resource: "quickstart" });
    expect(r.ok).toBe(true);
    expect((r.json as SocialCrawlSuccessResponse).credits_used).toBe(0);
  }, 30_000);
  // ── The utility platform: SocialCrawl's own DX surface ────────────────
  // Free, live, and the Actor's ground truth. These assert the CONTRACT the
  // four DX actions read, not just that the call returned 200.

  it("quickstart returns the full configuration contract for 0 credits", async () => {
    const r = await callUtility<Record<string, any>>(config, "quickstart");
    expect(r.ok).toBe(true);
    expect(r.envelope?.credits_used).toBe(0);

    const d = r.data!;
    expect(d.kind).toBe("quickstart");
    expect(d.base_url).toContain("/v1");
    expect(d.auth?.header).toBe("x-api-key");
    expect(d.billing?.tiers).toMatchObject({ standard: 1, advanced: 5, premium: 10 });
    expect(d.rate_limits?.requests_per_minute).toBeGreaterThan(0);
    expect(d.first_call?.curl).toContain("x-api-key");
    // The error taxonomy is the reason to call this at all.
    expect(Array.isArray(d.errors)).toBe(true);
    expect(d.errors.length).toBeGreaterThan(5);
    for (const e of d.errors) {
      expect(typeof e.code).toBe("string");
      expect(typeof e.http).toBe("number");
      expect(typeof e.meaning).toBe("string");
    }
  }, 30_000);

  it("endpoint guide returns a copy-paste request and the full param spec", async () => {
    const r = await callUtility<Record<string, any>>(config, "endpoint", {
      id: "tiktok/profile",
    });
    expect(r.ok).toBe(true);
    expect(r.envelope?.credits_used).toBe(0);

    const d = r.data!;
    expect(d.kind).toBe("endpoint_guide");
    expect(d.id).toBe("tiktok/profile");
    expect(d.path).toBe("/v1/tiktok/profile");
    expect(typeof d.credits?.cost).toBe("number");
    expect(typeof d.credits?.label).toBe("string");
    expect(d.request?.curl).toContain("curl");
    expect(d.cache?.ttl_seconds).toBeGreaterThan(0);
    // tiktok/profile is the canonical oneOf endpoint: handle OR user_id.
    expect(d.params?.one_of?.[0]?.options).toEqual(
      expect.arrayContaining(["handle", "user_id"]),
    );
  }, 30_000);

  it("agent context returns the llms corpus as markdown for 0 credits", async () => {
    const r = await callUtility<Record<string, any>>(config, "llms", {
      platform: "tiktok",
      format: "markdown",
    });
    expect(r.ok).toBe(true);
    expect(r.envelope?.credits_used).toBe(0);

    const d = r.data!;
    expect(d.kind).toBe("agent_context");
    expect(d.format).toBe("markdown");
    expect(d.scope).toBe("tiktok");
    expect(typeof d.content).toBe("string");
    expect(d.content.length).toBeGreaterThan(200);
  }, 30_000);

  it("the live catalog agrees with the catalog bundled into this Actor", async () => {
    const r = await callUtility<EndpointCatalog>(config, "endpoints");
    expect(r.ok).toBe(true);
    expect(r.envelope?.credits_used).toBe(0);

    const live = r.data!.endpoints;
    expect(live.length).toBeGreaterThan(300);

    const report = compareCatalog(live);
    // A red assertion here is not a bug in this repo's logic — it means the
    // registry moved and `npm run generate:data` has not been re-run.
    expect(summarizeDrift(report)).toMatch(/^In sync/);
  }, 60_000);
});
