import { describe, it, expect } from "vitest";
import { ALL_ENDPOINTS, findEndpoint } from "./catalog.js";
import { validateRequest } from "./validate.js";

describe("validateRequest", () => {
  it("rejects an unknown platform with a discovery hint", () => {
    const r = validateRequest("myspace", "profile", {});
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Unknown platform/i);
    expect(r.error).toMatch(/List platforms/i);
  });

  it("rejects an unknown resource for a known platform", () => {
    const r = validateRequest("tiktok", "not-a-real-endpoint", {});
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Unknown resource/i);
    expect(r.error).toMatch(/List endpoints/i);
  });

  it("rejects when a required param is missing (tiktok profile/videos needs handle)", () => {
    const r = validateRequest("tiktok", "profile/videos", {});
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Missing required parameter/i);
    expect(r.error).toMatch(/handle/);
  });

  it("passes when the required param is supplied", () => {
    const r = validateRequest("tiktok", "profile/videos", { handle: "charlidamelio" });
    expect(r.valid).toBe(true);
    expect(r.endpoint?.resource).toBe("profile/videos");
    expect(r.endpoint?.creditCost).toBeGreaterThan(0);
  });

  it("rejects when a oneOf group is unsatisfied (tiktok profile needs handle OR user_id)", () => {
    const r = validateRequest("tiktok", "profile", {});
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/one of/i);
    expect(r.error).toMatch(/handle/);
    expect(r.error).toMatch(/user_id/);
  });

  it("passes a oneOf group when any one member is supplied", () => {
    expect(validateRequest("tiktok", "profile", { handle: "x" }).valid).toBe(true);
    expect(validateRequest("tiktok", "profile", { user_id: "123" }).valid).toBe(true);
  });

  it("treats an empty-string oneOf value as not supplied", () => {
    const r = validateRequest("tiktok", "profile", { handle: "" });
    expect(r.valid).toBe(false);
  });

  it("returns the resolved endpoint metadata (credit tier) when valid", () => {
    const r = validateRequest("tiktok", "profile", { handle: "charlidamelio" });
    expect(r.valid).toBe(true);
    expect(r.endpoint?.creditTier).toBe("standard");
  });

  // ── Method-aware web routes ──────────────────────────────────────────────
  it("asks for a method when a web resource is exposed under several verbs", () => {
    const r = validateRequest("web", "monitors", { url: "https://example.com" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/multiple methods/i);
    expect(r.error).toMatch(/method/i);
  });

  it("resolves the right verb when method is supplied (POST web/monitors needs url)", () => {
    const ok = validateRequest("web", "monitors", { url: "https://example.com" }, "POST");
    expect(ok.valid).toBe(true);
    expect(ok.endpoint?.method).toBe("POST");

    const missing = validateRequest("web", "monitors", {}, "POST");
    expect(missing.valid).toBe(false);
    expect(missing.error).toMatch(/url/);
  });

  it("rejects a method the resource does not support, listing the valid ones", () => {
    const r = validateRequest("web", "crawl", { url: "https://x.com" }, "GET");
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/does not support method GET/i);
    expect(r.error).toMatch(/POST/);
  });

  it("treats a {token} path param as required (web/jobs/{job_id} needs job_id)", () => {
    const missing = validateRequest("web", "jobs/{job_id}", {}, "GET");
    expect(missing.valid).toBe(false);
    expect(missing.error).toMatch(/job_id/);

    const ok = validateRequest("web", "jobs/{job_id}", { job_id: "job_1" }, "GET");
    expect(ok.valid).toBe(true);
    expect(ok.endpoint?.method).toBe("GET");
  });
});

// ── Parameter constraints the registry declares and the API bills for ─────
describe("validateRequest — declared parameter constraints", () => {
  it("rejects a value outside an enum, naming the allowed values", () => {
    const r = validateRequest("naver", "blog/search", { query: "김치", sort: "not-a-sort" });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/must be one of/i);
    expect(r.error).toMatch(/sort/);
  });

  it("accepts a legal enum value", () => {
    const e = findEndpoint("naver", "blog/search")!;
    const sort = e.optionalParams.find((p) => p.name === "sort")!;
    const r = validateRequest("naver", "blog/search", {
      query: "김치",
      sort: sort.enumValues![0],
    });
    expect(r.valid).toBe(true);
  });

  it("enforces the declared numeric bounds on an integer param", () => {
    const withBounds = ALL_ENDPOINTS.find((e) =>
      e.optionalParams.some(
        (p) => p.type === "integer" && p.minimum !== undefined && p.maximum !== undefined,
      ),
    )!;
    const spec = withBounds.optionalParams.find(
      (p) => p.type === "integer" && p.minimum !== undefined && p.maximum !== undefined,
    )!;
    const required = Object.fromEntries(withBounds.params.map((p) => [p.name, p.example || "x"]));

    const tooHigh = validateRequest(withBounds.platform, withBounds.resource, {
      ...required,
      [spec.name]: spec.maximum! + 1,
    }, withBounds.method);
    expect(tooHigh.valid, `${withBounds.platform}/${withBounds.resource}`).toBe(false);
    expect(tooHigh.error).toMatch(/at most/);

    const tooLow = validateRequest(withBounds.platform, withBounds.resource, {
      ...required,
      [spec.name]: spec.minimum! - 1,
    }, withBounds.method);
    expect(tooLow.valid).toBe(false);
    expect(tooLow.error).toMatch(/at least/);
  });

  it("caps a comma-separated list param at its declared maximum", () => {
    // naver/search-trend takes at most 20 keywords.
    const keywords = Array.from({ length: 21 }, (_, i) => `k${i}`).join(",");
    const r = validateRequest("naver", "search-trend", {
      keywords,
      start_date: "2026-01-01",
      end_date: "2026-02-01",
      time_unit: "date",
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/at most 20/);
  });

  it("rejects an out-of-set entry inside a comma-separated list param", () => {
    const r = validateRequest("naver", "search-trend", {
      keywords: "김치",
      start_date: "2026-01-01",
      end_date: "2026-02-01",
      time_unit: "date",
      ages: "1,99",
    });
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/"99"/);
  });

  it("warns about an undocumented parameter without blocking the call", () => {
    const r = validateRequest("tiktok", "profile", { handle: "x", nope: "1" });
    expect(r.valid).toBe(true);
    expect(r.warnings.join(" ")).toMatch(/nope/);
  });

  it("never warns about the universal cursor and limit inputs", () => {
    const r = validateRequest("tiktok", "profile/videos", {
      handle: "x",
      cursor: "abc",
      limit: 20,
    });
    expect(r.valid).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});

// ── The non-registry monitors family ─────────────────────────────────────
describe("validateRequest — monitors", () => {
  it("requires recipe, cadence and webhook_url to create one", () => {
    const r = validateRequest("monitors", "create", {});
    expect(r.valid).toBe(false);
    for (const name of ["recipe", "cadence", "webhook_url"]) {
      expect(r.error, name).toMatch(new RegExp(name));
    }
  });

  it("accepts a complete create", () => {
    const r = validateRequest("monitors", "create", {
      recipe: "prism/brand-mentions",
      cadence: "daily",
      webhook_url: "https://example.com/hook",
    });
    expect(r.valid).toBe(true);
    expect(r.endpoint?.method).toBe("POST");
  });

  it("resolves pause and resume to the same PATCH with a pinned body", () => {
    const pause = validateRequest("monitors", "pause", { monitor_id: "mon_1" });
    const resume = validateRequest("monitors", "resume", { monitor_id: "mon_1" });
    expect(pause.endpoint?.method).toBe("PATCH");
    expect(pause.endpoint?.fixedParams).toEqual({ status: "paused" });
    expect(resume.endpoint?.fixedParams).toEqual({ status: "active" });
  });

  it("refuses a monitor id that could steer the request at another route", () => {
    for (const id of ["../credits/balance", "x?y=z", "a/b", "!!"]) {
      const r = validateRequest("monitors", "delete", { monitor_id: id });
      expect(r.valid, id).toBe(false);
      expect(r.error, id).toMatch(/monitor_id/);
    }
  });

  it("accepts an ordinary monitor id", () => {
    expect(validateRequest("monitors", "delete", { monitor_id: "mon_7f3c-9a2b" }).valid).toBe(true);
  });

  it("requires an id on every per-monitor operation", () => {
    for (const resource of ["get", "runs", "timeseries", "pause", "resume", "delete"]) {
      const r = validateRequest("monitors", resource, {});
      expect(r.valid, resource).toBe(false);
      expect(r.error, resource).toMatch(/monitor_id/);
    }
  });

  it("needs nothing to list them", () => {
    expect(validateRequest("monitors", "list", {}).valid).toBe(true);
  });
});
