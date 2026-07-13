import { describe, it, expect } from "vitest";
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
