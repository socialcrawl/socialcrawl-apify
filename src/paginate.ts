import { callApi, type ApiCallResult, type ClientConfig } from "./client.js";
import { publicPath } from "./catalog.js";
import type { Endpoint, SocialCrawlSuccessResponse } from "./types.js";

/**
 * Auto-pagination over the universal cursor contract.
 *
 * Every paginatable endpoint takes the same `cursor` input and returns the same
 * top-level `pagination` block (`next_cursor` / `has_more` / `page_size`) — no
 * per-platform special cases — so one loop covers all of them.
 *
 * Each page is a separate billed request. That is the whole reason the loop is
 * opt-in and bounded twice over (`maxItems` AND `maxPages`): a run that quietly
 * walked a large feed would spend the user's credits without ever having said
 * how many. The summary reports exactly why it stopped and what it cost.
 */

export type StopReason =
  | "single_page"
  | "exhausted"
  | "max_items"
  | "max_pages"
  | "empty_page"
  | "cursor_stalled"
  | "error";

export interface PageResult {
  pageIndex: number;
  result: ApiCallResult;
  envelope: SocialCrawlSuccessResponse | null;
  itemCount: number;
}

export interface PaginationSummary {
  pages: number;
  items: number;
  creditsUsed: number;
  stopReason: StopReason;
  /** Cursor for the page AFTER the last one fetched, when more remain. */
  nextCursor: string | null;
  /** Populated when `stopReason` is "error". */
  errorMessage?: string;
}

export interface PaginateOptions {
  /** Stop once this many items have been collected. `0` disables the cap. */
  maxItems: number;
  /** Hard ceiling on billed requests, whatever `maxItems` says. */
  maxPages: number;
  /** Applied to the FIRST page only — reusing it would replay page 1 forever. */
  idempotencyKey?: string;
  /** Called once per successful page, in order, before the next is requested. */
  onPage: (page: PageResult) => Promise<void>;
}

/** Count the rows a response actually carried. */
function itemCountOf(envelope: SocialCrawlSuccessResponse | null): number {
  const data = envelope?.data;
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const items = (data as Record<string, unknown>).items;
    if (Array.isArray(items)) return items.length;
  }
  return data === undefined || data === null ? 0 : 1;
}

/**
 * Fetch one endpoint, following `next_cursor` until a stop condition is met.
 * A single-page endpoint (or `maxItems <= 0`) makes exactly one request, so the
 * caller can always route through this function.
 */
export async function runPaginated(
  config: ClientConfig,
  endpoint: Endpoint,
  params: Record<string, unknown>,
  options: PaginateOptions,
): Promise<PaginationSummary> {
  const canPage = Boolean(endpoint.pagination) && !endpoint.singlePage;
  const wantsPaging = canPage && options.maxItems > 0;
  const pageCap = wantsPaging ? Math.max(1, options.maxPages) : 1;

  let pages = 0;
  let items = 0;
  let creditsUsed = 0;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (;;) {
    const pageParams = { ...params };
    if (cursor !== undefined) pageParams.cursor = cursor;

    const result = await callApi(config, {
      platform: endpoint.platform,
      resource: endpoint.resource,
      path: endpoint.path,
      method: endpoint.method,
      params: pageParams,
      // Only page 1 carries the key: the API replays a 24h-old response for a
      // repeated key, so reusing it on page 2 would serve page 1 again.
      idempotencyKey: pages === 0 ? options.idempotencyKey : undefined,
    });

    if (!result.ok) {
      return {
        pages,
        items,
        creditsUsed,
        stopReason: "error",
        nextCursor: cursor ?? null,
        errorMessage: result.errorMessage ?? `Request failed (HTTP ${result.status}).`,
      };
    }

    const envelope = result.json as SocialCrawlSuccessResponse | null;
    const itemCount = itemCountOf(envelope);
    pages += 1;
    items += itemCount;
    creditsUsed += envelope?.credits_used ?? 0;

    await options.onPage({ pageIndex: pages - 1, result, envelope, itemCount });

    if (!wantsPaging) {
      return {
        pages,
        items,
        creditsUsed,
        stopReason: canPage ? "exhausted" : "single_page",
        nextCursor: envelope?.pagination?.next_cursor ?? null,
      };
    }

    const block = envelope?.pagination;
    const next = block?.next_cursor ?? null;

    if (!block?.has_more || !next) {
      return { pages, items, creditsUsed, stopReason: "exhausted", nextCursor: null };
    }
    if (itemCount === 0) {
      // An empty page never advances honestly — stop rather than pay again.
      return { pages, items, creditsUsed, stopReason: "empty_page", nextCursor: next };
    }
    if (seenCursors.has(next)) {
      return { pages, items, creditsUsed, stopReason: "cursor_stalled", nextCursor: next };
    }
    if (items >= options.maxItems) {
      return { pages, items, creditsUsed, stopReason: "max_items", nextCursor: next };
    }
    if (pages >= pageCap) {
      return { pages, items, creditsUsed, stopReason: "max_pages", nextCursor: next };
    }

    seenCursors.add(next);
    cursor = next;
  }
}

/** One-line explanation of why the walk stopped, for the run status message. */
export function explainStop(
  endpoint: Endpoint,
  summary: PaginationSummary,
): string {
  switch (summary.stopReason) {
    case "single_page":
      return `${publicPath(endpoint)} serves a single page — auto-pagination does not apply.`;
    case "exhausted":
      return "Reached the end of the results.";
    case "max_items":
      return `Hit the maxItems limit — more results remain. Raise maxItems to continue (each page is billed).`;
    case "max_pages":
      return `Hit the maxPages safety cap — more results remain. Raise maxPages to continue (each page is billed).`;
    case "empty_page":
      return "Stopped on an empty page — the API had no more rows to give.";
    case "cursor_stalled":
      return "Stopped because the cursor stopped advancing — every further page would repeat what you already have.";
    case "error":
      return summary.errorMessage ?? "Stopped on an error.";
  }
}
