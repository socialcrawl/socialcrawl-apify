import { describe, it, expect } from "vitest";
import { pricingNote, pricingFor } from "./pricing.js";
import type { Endpoint } from "./types.js";

function ep(partial: Partial<Endpoint>): Endpoint {
  return {
    platform: "x",
    resource: "y",
    method: "GET",
    params: [],
    optionalParams: [],
    oneOfGroups: [],
    creditTier: "standard",
    creditCost: 1,
    archetype: "Post",
    summary: "",
    description: "",
    ...partial,
  };
}

describe("pricingNote", () => {
  it("labels the three ladder tiers", () => {
    expect(pricingNote(ep({ creditTier: "standard", creditCost: 1 }))).toMatch(/Standard tier — 1 credit\b/);
    expect(pricingNote(ep({ creditTier: "advanced", creditCost: 5 }))).toMatch(/Advanced tier — 5 credits/);
    expect(pricingNote(ep({ creditTier: "premium", creditCost: 10 }))).toMatch(/Premium tier — 10 credits/);
  });

  it("flags flat-rate overrides outside the ladder", () => {
    expect(pricingNote(ep({ creditTier: "advanced", creditCost: 20 }))).toMatch(/Flat rate — 20 credits/);
    expect(pricingNote(ep({ creditTier: "premium", creditCost: 25 }))).toMatch(/Flat rate — 25 credits/);
  });

  it("calls out the free (0-credit) stateful control routes", () => {
    expect(pricingNote(ep({ creditCost: 0 }))).toMatch(/Free — 0 credits/);
  });
});

describe("pricingFor", () => {
  it("returns a full, self-describing pricing row", () => {
    const row = pricingFor(ep({ platform: "web", resource: "agent", method: "POST", creditTier: "premium", creditCost: 25 }));
    expect(row).toMatchObject({
      platform: "web",
      resource: "agent",
      method: "POST",
      public_path: "/v1/web/agent",
      credit_tier: "premium",
      credit_cost: 25,
      is_free: false,
      is_flat_override: true,
    });
    expect(row.pricing_note).toMatch(/Flat rate/);
  });

  it("marks free control routes", () => {
    const row = pricingFor(ep({ platform: "web", resource: "jobs", creditCost: 0 }));
    expect(row.is_free).toBe(true);
    expect(row.is_flat_override).toBe(false);
  });
});
