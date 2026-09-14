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

/**
 * 11/09/2026 customer report (MCP, same formatter pattern here): errors dropped
 * the API's `request_id` and specific `error.message`, leaving nothing to quote
 * to support. Every branch must pass the message, `details.reason` and the id on.
 */
describe("formatHttpError keeps the server's message, reason and request_id", () => {
  const opts = { platform: "instagram", resource: "post/transcript" };
  const envelope = (error: Record<string, unknown>, requestId?: string) =>
    ({
      success: false,
      error,
      credits_used: 0,
      ...(requestId ? { request_id: requestId } : {}),
      credits_remaining: 812,
    }) as never;

  it("404 RESOURCE_NOT_FOUND: server message, reason and request_id", () => {
    const msg = formatHttpError(
      404,
      envelope(
        {
          type: "RESOURCE_NOT_FOUND",
          message:
            "The video is unavailable (deleted, private, or it never existed). You were not charged for this request.",
          status: 404,
          details: { reason: "video_gone" },
        },
        "req-404abc",
      ),
      opts,
    );
    expect(msg).toMatch(/Resource not found/);
    expect(msg).toContain("The video is unavailable (deleted, private, or it never existed).");
    expect(msg).toContain("You were not charged for this request.");
    expect(msg).toContain("reason: video_gone");
    expect(msg).toContain("request_id: req-404abc");
    expect(msg).not.toContain("doesn't exist");
  });

  it("502: passes the upstream-failure message through with the request_id", () => {
    const msg = formatHttpError(
      502,
      envelope(
        {
          type: "UPSTREAM_ERROR",
          message:
            "pinterest returned an error for this request and every available source failed. Your credits have been refunded. This is usually transient, retry after 30 seconds.",
          status: 502,
        },
        "req-502def",
      ),
      { platform: "pinterest", resource: "search" },
    );
    expect(msg).toContain("pinterest returned an error for this request and every available source failed.");
    expect(msg).toContain("request_id: req-502def");
    expect(msg).not.toContain("reason:");
  });

  it("503: uses the server's cause for the outage", () => {
    const msg = formatHttpError(
      503,
      envelope(
        {
          type: "SERVICE_UNAVAILABLE",
          message: "instagram is momentarily rate-limited upstream. Retry after 30s. Your credits have been refunded.",
          status: 503,
        },
        "req-503ghi",
      ),
      opts,
    );
    expect(msg).toContain("instagram is momentarily rate-limited upstream. Retry after 30s.");
    expect(msg).toContain("request_id: req-503ghi");
  });

  it("429: says which limit was hit (rate window, not concurrency)", () => {
    const msg = formatHttpError(
      429,
      envelope(
        {
          type: "RATE_LIMITED",
          message:
            "Request rate limit exceeded. Limit: 600 requests per minute. Honor the Retry-After header, then back off with jitter (see /docs/rate-limits).",
          status: 429,
        },
        "req-429jkl",
      ),
      opts,
    );
    expect(msg).toContain("Limit: 600 requests per minute");
    expect(msg).not.toContain("concurrent");
    expect(msg).toContain("request_id: req-429jkl");
  });

  it("401: keeps the apiKey hint and adds the server's message and request_id", () => {
    const msg = formatHttpError(
      401,
      envelope({ type: "INVALID_API_KEY", message: "API key not found, revoked, or expired.", status: 401 }, "req-401mno"),
      opts,
    );
    expect(msg).toMatch(/Invalid API key/);
    expect(msg).toContain("API key not found, revoked, or expired.");
    expect(msg).toContain("`apiKey`");
    expect(msg).toContain("request_id: req-401mno");
  });

  it("409 on a non-idempotency conflict: passes the cohort message through instead of blaming the key", () => {
    const msg = formatHttpError(
      409,
      envelope(
        {
          type: "COHORT_IDENTITY_CONFLICT",
          message: "The normalized identity is already assigned to another external ID.",
          status: 409,
        },
        "req-409pqr",
      ),
      { platform: "cohorts", resource: "members" },
    );
    expect(msg).toContain("already assigned to another external ID");
    expect(msg).not.toContain("Idempotency-Key");
    expect(msg).toContain("request_id: req-409pqr");
  });

  it("non-JSON body: falls back to the X-Request-Id header", () => {
    const msg = formatHttpError(502, null, opts, "req-hdr123");
    expect(msg).toMatch(/Upstream error/);
    expect(msg).toContain("request_id: req-hdr123");
  });

  it("prefers the body's request_id over the header", () => {
    const msg = formatHttpError(
      502,
      envelope({ type: "UPSTREAM_ERROR", message: "tiktok returned an error.", status: 502 }, "req-body1"),
      opts,
      "req-header1",
    );
    expect(msg).toContain("request_id: req-body1");
    expect(msg).not.toContain("req-header1");
  });

  it("no request_id anywhere: omits it rather than printing a placeholder", () => {
    const msg = formatHttpError(
      502,
      envelope({ type: "UPSTREAM_ERROR", message: "tiktok returned an error.", status: 502 }),
      opts,
    );
    expect(msg).toContain("tiktok returned an error.");
    expect(msg).not.toContain("request_id");
    expect(msg).not.toContain("undefined");
    expect(msg).not.toContain("null");
  });
});

describe("callApi surfaces the request_id on errors", () => {
  afterEach(() => vi.unstubAllGlobals());
  const config = { apiKey: "sc_test", baseUrl: "https://api.test" };

  it("reads X-Request-Id when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("upstream connect error", { status: 503, headers: { "X-Request-Id": "req-cl-hdr" } })),
    );
    const r = await callApi(config, { platform: "tiktok", resource: "profile" });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toContain("request_id: req-cl-hdr");
  });

  it("carries the body's request_id and server message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              error: { type: "UPSTREAM_ERROR", message: "youtube returned an error for this request.", status: 502 },
              request_id: "req-cl-body",
            }),
            { status: 502 },
          ),
      ),
    );
    const r = await callApi(config, { platform: "youtube", resource: "video" });
    expect(r.errorMessage).toContain("youtube returned an error for this request.");
    expect(r.errorMessage).toContain("request_id: req-cl-body");
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
