import { describe, it, expect, vi, afterEach } from "vitest";
import { buildUrl, formatHttpError, callApi, resolvePath } from "./client.js";

describe("buildUrl", () => {
  it("builds the public /v1/{platform}/{resource} path", () => {
    expect(buildUrl("https://www.socialcrawl.dev", { platform: "tiktok", resource: "profile" })).toBe(
      "https://www.socialcrawl.dev/v1/tiktok/profile",
    );
  });

  it("collapses the `meta` platform to a top-level /v1/{resource} path", () => {
    expect(buildUrl("https://www.socialcrawl.dev", { platform: "meta", resource: "credits/balance" })).toBe(
      "https://www.socialcrawl.dev/v1/credits/balance",
    );
  });

  it("appends and URL-encodes query params", () => {
    const url = buildUrl("https://www.socialcrawl.dev", {
      platform: "search",
      resource: "everywhere",
      params: { query: "electric cars" },
    });
    expect(url).toBe("https://www.socialcrawl.dev/v1/search/everywhere?query=electric+cars");
  });

  it("omits the query string when there are no params", () => {
    const url = buildUrl("https://x.test", { platform: "tiktok", resource: "profile", params: {} });
    expect(url).toBe("https://x.test/v1/tiktok/profile");
  });

  it("substitutes a {token} path template from params and drops it from the query", () => {
    const url = buildUrl("https://x.test", {
      platform: "web",
      resource: "jobs/{job_id}",
      params: { job_id: "job_abc", limit: 5 },
    });
    expect(url).toBe("https://x.test/v1/web/jobs/job_abc?limit=5");
  });
});

describe("resolvePath", () => {
  it("fills {token} placeholders and reports the consumed keys", () => {
    const r = resolvePath("web", "monitors/{monitor_id}/checks", { monitor_id: "wm_1", limit: 10 });
    expect(r.path).toBe("/v1/web/monitors/wm_1/checks");
    expect(r.consumed).toEqual(["monitor_id"]);
  });

  it("leaves plain resources untouched with no consumed keys", () => {
    const r = resolvePath("tiktok", "profile", { handle: "x" });
    expect(r.path).toBe("/v1/tiktok/profile");
    expect(r.consumed).toEqual([]);
  });
});

describe("resolvePath — explicit path templates (non-registry families)", () => {
  it("uses the given path instead of /v1/{platform}/{resource}", () => {
    // `monitors/pause` is a PATCH on the monitor itself; there is no /pause route.
    const { path, consumed } = resolvePath(
      "monitors",
      "pause",
      { monitor_id: "mon_1" },
      "/v1/monitors/{monitor_id}",
    );
    expect(path).toBe("/v1/monitors/mon_1");
    expect(consumed).toEqual(["monitor_id"]);
  });

  it("handles a collection route with no tokens", () => {
    const { path, consumed } = resolvePath("monitors", "create", {}, "/v1/monitors");
    expect(path).toBe("/v1/monitors");
    expect(consumed).toEqual([]);
  });

  it("encodes a hostile id so it cannot steer the request at another route", () => {
    const { path } = resolvePath(
      "monitors",
      "delete",
      { monitor_id: "../credits/balance" },
      "/v1/monitors/{monitor_id}",
    );
    expect(path).toBe("/v1/monitors/..%2Fcredits%2Fbalance");
    expect(path).not.toContain("/credits/balance");
  });
});

describe("formatHttpError", () => {
  const opts = { platform: "tiktok", resource: "profile" };

  it("explains a 401 as a bad API key", () => {
    expect(formatHttpError(401, null, opts)).toMatch(/Invalid API key/i);
  });

  it("surfaces remaining credits on a 402", () => {
    const msg = formatHttpError(402, { credits_remaining: 3 } as never, opts);
    expect(msg).toMatch(/Insufficient credits/i);
    expect(msg).toMatch(/3 remaining/);
  });

  it("distinguishes an upstream RESOURCE_NOT_FOUND (refunded) from a wrong endpoint 404", () => {
    const refunded = formatHttpError(404, { error: { type: "RESOURCE_NOT_FOUND" } } as never, opts);
    expect(refunded).toMatch(/refunded/i);

    const wrongEndpoint = formatHttpError(404, null, opts);
    expect(wrongEndpoint).toMatch(/not found/i);
    expect(wrongEndpoint).toMatch(/List endpoints/i);
  });

  it("notes credits were auto-refunded on a 502", () => {
    expect(formatHttpError(502, null, opts)).toMatch(/refunded/i);
  });

  it("falls back to the error type/message and doc_url for unmapped statuses", () => {
    const msg = formatHttpError(
      418,
      { error: { type: "TEAPOT", message: "short and stout", doc_url: "https://docs.test/418" } } as never,
      opts,
    );
    expect(msg).toMatch(/TEAPOT/);
    expect(msg).toMatch(/short and stout/);
    expect(msg).toMatch(/https:\/\/docs\.test\/418/);
  });
});

describe("callApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  const config = { apiKey: "sc_test", baseUrl: "https://api.test" };

  it("sends the x-api-key header and parses a successful JSON envelope", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["x-api-key"]).toBe("sc_test");
      return new Response(JSON.stringify({ success: true, data: { ok: 1 } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await callApi(config, { platform: "tiktok", resource: "profile", params: { handle: "x" } });
    expect(r.ok).toBe(true);
    expect(r.status).toBe(200);
    expect((r.json as { data: { ok: number } }).data.ok).toBe(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("forwards an Idempotency-Key header only when provided", async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("uuid-1");
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    await callApi(config, { platform: "tiktok", resource: "profile", idempotencyKey: "uuid-1" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("returns ok:false with an actionable message on an HTTP error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: { type: "UNAUTHORIZED" } }), { status: 401 })),
    );
    const r = await callApi(config, { platform: "tiktok", resource: "profile" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(401);
    expect(r.errorMessage).toMatch(/Invalid API key/i);
  });

  it("returns a network-error message when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const r = await callApi(config, { platform: "tiktok", resource: "profile" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(0);
    expect(r.errorMessage).toMatch(/Network error/i);
  });

  it("sends POST params as a typed JSON body (not a query string)", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      seenUrl = url;
      seenInit = init;
      return new Response(JSON.stringify({ success: true, data: { job_id: "j1" } }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await callApi(config, {
      platform: "web",
      resource: "crawl",
      method: "POST",
      params: { url: "https://example.com", limit: 10, formats: ["markdown"] },
    });

    expect(seenInit.method).toBe("POST");
    expect(seenUrl).toBe("https://api.test/v1/web/crawl"); // no query string
    expect((seenInit.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // Types preserved in the body — number stays a number, array stays an array.
    expect(JSON.parse(seenInit.body as string)).toEqual({
      url: "https://example.com",
      limit: 10,
      formats: ["markdown"],
    });
  });

  it("substitutes a path id and sends DELETE with no body", async () => {
    let seenUrl = "";
    let seenInit: RequestInit = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenInit = init;
        return new Response(null, { status: 204 });
      }),
    );

    const r = await callApi(config, {
      platform: "web",
      resource: "monitors/{monitor_id}",
      method: "DELETE",
      params: { monitor_id: "wm_9" },
    });

    expect(seenInit.method).toBe("DELETE");
    expect(seenUrl).toBe("https://api.test/v1/web/monitors/wm_9");
    expect(seenInit.body).toBeUndefined();
    // 204 → synthesised success envelope, never a throw.
    expect(r.ok).toBe(true);
    expect(r.status).toBe(204);
    expect(r.path).toBe("/v1/web/monitors/wm_9");
    expect((r.json as { success: boolean }).success).toBe(true);
  });
});
