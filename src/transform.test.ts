import { describe, it, expect } from "vitest";
import { stringifyParams, cleanParams, rowsFromEnvelope } from "./transform.js";
import { findEndpoint } from "./catalog.js";
import type { SocialCrawlSuccessResponse } from "./types.js";

function envelope(data: unknown): SocialCrawlSuccessResponse {
  return {
    success: true,
    platform: "tiktok",
    endpoint: "/v1/tiktok/profile",
    data,
    credits_used: 1,
    credits_remaining: 99,
    request_id: "req-abc",
    cached: false,
  };
}

describe("stringifyParams", () => {
  it("coerces every value to a string", () => {
    expect(stringifyParams({ handle: "abc", count: 5, deep: true })).toEqual({
      handle: "abc",
      count: "5",
      deep: "true",
    });
  });

  it("drops undefined, null, and empty-string values", () => {
    expect(
      stringifyParams({ a: "x", b: undefined, c: null, d: "" }),
    ).toEqual({ a: "x" });
  });

  it("returns an empty object for non-object input", () => {
    expect(stringifyParams(undefined)).toEqual({});
  });
});

describe("cleanParams", () => {
  it("preserves value types (numbers, booleans, arrays) for JSON bodies", () => {
    expect(cleanParams({ limit: 10, flag: true, formats: ["markdown"] })).toEqual({
      limit: 10,
      flag: true,
      formats: ["markdown"],
    });
  });

  it("drops undefined, null, and empty-string values", () => {
    expect(cleanParams({ a: "x", b: undefined, c: null, d: "", e: 0, f: false })).toEqual({
      a: "x",
      e: 0,
      f: false,
    });
  });
});

describe("rowsFromEnvelope", () => {
  it("emits one row per element for array data", () => {
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile/videos",
      envelope([{ id: "1" }, { id: "2" }]),
      "",
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ id: "1", _sc_platform: "tiktok" });
  });

  it("emits one row per item when data has an items array", () => {
    const rows = rowsFromEnvelope(
      "reddit",
      "search",
      envelope({ items: [{ id: "a" }, { id: "b" }, { id: "c" }] }),
      "",
    );
    expect(rows).toHaveLength(3);
    expect(rows[2]).toMatchObject({ id: "c" });
  });

  it("emits a single row for a single object", () => {
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      envelope({ handle: "charli", followers: 100 }),
      "",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "charli", followers: 100 });
  });

  it("wraps primitive data under a `value` key", () => {
    const rows = rowsFromEnvelope("x", "y", envelope("hello"), "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ value: "hello" });
  });

  it("attaches _sc_-prefixed credit/request metadata to every row", () => {
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      envelope({ handle: "charli" }),
      "",
    );
    expect(rows[0]).toMatchObject({
      _sc_platform: "tiktok",
      _sc_endpoint: "/v1/tiktok/profile",
      _sc_credits_used: 1,
      _sc_credits_remaining: 99,
      _sc_request_id: "req-abc",
      _sc_cached: false,
    });
  });

  it("never lets data fields collide with meta fields (data wins on its own keys, meta is _sc_-namespaced)", () => {
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      envelope({ platform: "USER_DATA", credits_used: 9999 }),
      "",
    );
    // user's own `platform`/`credits_used` survive; our meta lives under _sc_*
    expect(rows[0]!.platform).toBe("USER_DATA");
    expect(rows[0]!.credits_used).toBe(9999);
    expect(rows[0]!._sc_platform).toBe("tiktok");
    expect(rows[0]!._sc_credits_used).toBe(1);
  });

  it("falls back to parsing raw text and null meta when the envelope is null", () => {
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      null,
      JSON.stringify({ handle: "fromRaw" }),
    );
    expect(rows[0]).toMatchObject({
      handle: "fromRaw",
      _sc_credits_used: null,
      _sc_cached: null,
    });
  });
});

describe("rows are read from the path the registry declares", () => {
  const profile = findEndpoint("tiktok", "profile")!;
  const pinSearch = findEndpoint("pinterest", "search")!;

  it("takes a singular object from its declared key, not from a guess", () => {
    // `data.author` is where a profile lives. The old structural guess wrapped
    // the WHOLE data object as one row, dragging sibling keys in with it.
    expect(profile.responseShape?.root).toBe("data.author");
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      envelope({ author: { handle: "charli", followers: 10 }, warnings: ["x"] }),
      "",
      undefined,
      { endpoint: profile },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ handle: "charli", followers: 10 });
    expect(rows[0]).not.toHaveProperty("warnings");
  });

  it("labels each row with the canonical object kind", () => {
    const rows = rowsFromEnvelope(
      "pinterest",
      "search",
      envelope({ items: [{ id: "a" }, { id: "b" }] }),
      "",
      undefined,
      { endpoint: pinSearch },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!._sc_item_kind).toBe(pinSearch.responseShape?.itemKey);
  });

  it("falls back to the structural guess when the declared path is absent", () => {
    // A snapshot that has drifted from the live API must never cost someone the
    // rows they just paid for.
    const rows = rowsFromEnvelope(
      "tiktok",
      "profile",
      envelope({ items: [{ id: "a" }] }),
      "",
      undefined,
      { endpoint: profile },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "a" });
  });

  it("still works for an endpoint that declares no shape", () => {
    const rows = rowsFromEnvelope("prism", "voice", envelope({ items: [{ id: "a" }] }), "");
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty("_sc_item_kind");
  });

  it("lifts the join receipt onto every row", () => {
    // `data.hydration` is the receipt for the extra credits a join spends;
    // leaving it in the envelope alone hides it from anyone reading the dataset.
    const rows = rowsFromEnvelope(
      "pinterest",
      "search",
      envelope({
        items: [{ id: "a" }, { id: "b" }],
        hydration: { rows: 18, filled: 18, credits_held: 18, credits_kept: 17, ms: 5200 },
      }),
      "",
      undefined,
      { endpoint: pinSearch },
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row._sc_hydration_filled).toBe(18);
      expect(row._sc_hydration_credits_kept).toBe(17);
    }
  });

  it("keeps a nested hydration value out of the rows", () => {
    const rows = rowsFromEnvelope(
      "pinterest",
      "search",
      envelope({ items: [{ id: "a" }], hydration: { filled: 1, per_row: [{ id: "a" }] } }),
      "",
      undefined,
      { endpoint: pinSearch },
    );
    expect(rows[0]!._sc_hydration_filled).toBe(1);
    expect(rows[0]).not.toHaveProperty("_sc_hydration_per_row");
  });
});
