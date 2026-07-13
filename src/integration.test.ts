import { describe, it, expect } from "vitest";
import { callApi } from "./client.js";
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

  it("fetches a TikTok profile and charges credits", async () => {
    const r = await callApi(config, {
      platform: "tiktok",
      resource: "profile",
      params: { handle: "charlidamelio" },
    });

    expect(r.ok).toBe(true);
    const env = r.json as SocialCrawlSuccessResponse;
    expect(env.success).toBe(true);
    expect(env.platform).toBe("tiktok");
    expect(env.credits_used).toBeGreaterThanOrEqual(1);
    expect(typeof env.credits_remaining).toBe("number");
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
});
