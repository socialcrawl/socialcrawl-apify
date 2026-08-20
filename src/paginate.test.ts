import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findEndpoint } from "./catalog.js";
import { explainStop, runPaginated, type PageResult } from "./paginate.js";
import type { ClientConfig } from "./client.js";

const config: ClientConfig = { apiKey: "sc_test", baseUrl: "https://api.test" };

/** A success envelope with `count` items and an optional forward cursor. */
function page(count: number, nextCursor: string | null, creditsUsed = 1): string {
  return JSON.stringify({
    success: true,
    platform: "tiktok",
    endpoint: "profile/videos",
    data: { items: Array.from({ length: count }, (_, i) => ({ id: i })) },
    credits_used: creditsUsed,
    credits_remaining: 100,
    request_id: "req-1",
    cached: false,
    pagination: {
      next_cursor: nextCursor,
      has_more: nextCursor !== null,
      page_size: count,
    },
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function respond(bodies: string[]): void {
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => body,
    });
  }
}

/** Collect the pages the loop handed back. */
function collector(): { pages: PageResult[]; onPage: (p: PageResult) => Promise<void> } {
  const pages: PageResult[] = [];
  return {
    pages,
    onPage: async (p) => {
      pages.push(p);
    },
  };
}

const listEndpoint = findEndpoint("tiktok", "profile/videos")!;
const singleEndpoint = findEndpoint("tiktok", "profile")!;

describe("runPaginated", () => {
  it("makes exactly one request when maxItems is 0", async () => {
    respond([page(20, "cur-2")]);
    const { onPage, pages } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 0,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(pages).toHaveLength(1);
    expect(summary).toMatchObject({ pages: 1, items: 20, creditsUsed: 1, stopReason: "exhausted" });
  });

  it("follows next_cursor until maxItems is reached", async () => {
    respond([page(20, "cur-2"), page(20, "cur-3"), page(20, "cur-4")]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 50,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(summary).toMatchObject({
      pages: 3,
      items: 60,
      creditsUsed: 3,
      stopReason: "max_items",
      nextCursor: "cur-4",
    });
  });

  it("sends the returned cursor on the next request", async () => {
    respond([page(2, "cur-2"), page(2, null)]);
    const { onPage } = collector();

    await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 100,
      maxPages: 10,
      onPage,
    });

    const secondUrl = String(fetchMock.mock.calls[1]![0]);
    expect(secondUrl).toContain("cursor=cur-2");
    expect(String(fetchMock.mock.calls[0]![0])).not.toContain("cursor=");
  });

  it("stops honestly when the API says there is no more", async () => {
    respond([page(20, "cur-2"), page(7, null)]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 1000,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary).toMatchObject({ stopReason: "exhausted", items: 27, nextCursor: null });
  });

  it("respects maxPages even when maxItems is far higher", async () => {
    respond([page(20, "c2"), page(20, "c3")]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 10_000,
      maxPages: 2,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary.stopReason).toBe("max_pages");
  });

  it("stops rather than paying again when the cursor stops advancing", async () => {
    respond([page(5, "same"), page(5, "same")]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 1000,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary.stopReason).toBe("cursor_stalled");
  });

  it("stops on an empty page even if the API still claims there is more", async () => {
    respond([page(5, "c2"), page(0, "c3")]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 1000,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(summary.stopReason).toBe("empty_page");
  });

  it("never pages a single-page endpoint, whatever maxItems says", async () => {
    respond([page(1, "cur-2")]);
    const { onPage } = collector();

    const summary = await runPaginated(config, singleEndpoint, { handle: "x" }, {
      maxItems: 500,
      maxPages: 10,
      onPage,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(summary.stopReason).toBe("single_page");
  });

  it("sends the idempotency key on page 1 only — reusing it would replay page 1", async () => {
    respond([page(20, "cur-2"), page(20, null)]);
    const { onPage } = collector();

    await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 100,
      maxPages: 10,
      idempotencyKey: "key-abc",
      onPage,
    });

    const headersOf = (i: number): Record<string, string> =>
      (fetchMock.mock.calls[i]![1] as { headers: Record<string, string> }).headers;
    expect(headersOf(0)["Idempotency-Key"]).toBe("key-abc");
    expect(headersOf(1)["Idempotency-Key"]).toBeUndefined();
  });

  it("keeps the pages it already paid for when a later page fails", async () => {
    respond([page(20, "cur-2")]);
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 502,
      text: async () => JSON.stringify({ error: { type: "UPSTREAM_ERROR", message: "boom" } }),
    });
    const { onPage, pages } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 1000,
      maxPages: 10,
      onPage,
    });

    expect(pages).toHaveLength(1);
    expect(summary).toMatchObject({ pages: 1, items: 20, stopReason: "error" });
    expect(summary.errorMessage).toBeTruthy();
  });

  it("counts a cache hit as 0 credits", async () => {
    respond([page(20, null, 0)]);
    const { onPage } = collector();

    const summary = await runPaginated(config, listEndpoint, { handle: "x" }, {
      maxItems: 0,
      maxPages: 1,
      onPage,
    });

    expect(summary.creditsUsed).toBe(0);
  });
});

describe("explainStop", () => {
  it("tells the user how to get the rest when a cap was hit", () => {
    for (const reason of ["max_items", "max_pages"] as const) {
      const text = explainStop(listEndpoint, {
        pages: 2,
        items: 40,
        creditsUsed: 2,
        stopReason: reason,
        nextCursor: "c",
      });
      expect(text).toMatch(/more results remain/i);
      expect(text).toMatch(/billed/i);
    }
  });

  it("surfaces the error message verbatim", () => {
    expect(
      explainStop(listEndpoint, {
        pages: 1,
        items: 0,
        creditsUsed: 0,
        stopReason: "error",
        nextCursor: null,
        errorMessage: "Insufficient credits",
      }),
    ).toBe("Insufficient credits");
  });
});
