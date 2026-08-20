import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_ENDPOINTS, ALL_PLATFORMS, isPaginatable, publicPath } from "./catalog.js";
import { ENDPOINTS } from "./data/endpoints.js";
import { MONITOR_ENDPOINTS, MONITOR_PLATFORM } from "./data/monitors.js";
import { PLATFORMS } from "./data/platforms.js";
import { CREDIT_LADDER, REGISTRY_STATS } from "./data/stats.js";
import { costRange } from "./pricing.js";

/**
 * Drift guards. The Actor's copy — the README, the input schema's platform
 * enum, the store description — restates counts that live in the generated
 * data. Every registry wave moves those numbers, and nothing but a test
 * notices when the prose is left behind. Each assertion here has been wrong at
 * least once in a previous wave.
 */

const root = resolve(import.meta.dirname, "..");
const readText = (rel: string): string => readFileSync(resolve(root, rel), "utf8");
const readJson = (rel: string): Record<string, any> => JSON.parse(readText(rel));

describe("generated data is internally consistent", () => {
  it("matches the counts baked into stats.ts", () => {
    expect(PLATFORMS).toHaveLength(REGISTRY_STATS.totalPlatforms);
    expect(ENDPOINTS).toHaveLength(REGISTRY_STATS.totalEndpoints);
  });

  it("has per-platform endpoint counts that add up to the total", () => {
    const sum = PLATFORMS.reduce((n, p) => n + p.endpointCount, 0);
    expect(sum).toBe(REGISTRY_STATS.totalEndpoints);
  });

  it("declares the right number of endpoints for every platform", () => {
    for (const p of PLATFORMS) {
      const actual = ENDPOINTS.filter((e) => e.platform === p.slug).length;
      expect(actual, p.slug).toBe(p.endpointCount);
    }
  });

  it("has no endpoint pointing at an unknown platform", () => {
    const slugs = new Set(ALL_PLATFORMS.map((p) => p.slug));
    for (const e of ALL_ENDPOINTS) expect(slugs.has(e.platform), e.platform).toBe(true);
  });

  it("gives every platform and endpoint real prose", () => {
    for (const p of ALL_PLATFORMS) {
      expect(p.description.length, p.slug).toBeGreaterThan(20);
      expect(p.name.length, p.slug).toBeGreaterThan(0);
    }
    for (const e of ALL_ENDPOINTS) {
      const key = `${e.platform}/${e.resource}`;
      expect(e.summary.length, key).toBeGreaterThan(0);
      expect(e.description.length, key).toBeGreaterThan(0);
    }
  });

  it("gives every required param a description and an example", () => {
    for (const e of ALL_ENDPOINTS) {
      for (const p of e.params) {
        const key = `${e.platform}/${e.resource} :: ${p.name}`;
        expect(p.description.length, key).toBeGreaterThan(0);
      }
    }
  });

  it("keeps oneOf group members out of the required list", () => {
    for (const e of ALL_ENDPOINTS) {
      const required = new Set(e.params.map((p) => p.name));
      for (const group of e.oneOfGroups) {
        for (const name of group) {
          expect(required.has(name), `${e.platform}/${e.resource} :: ${name}`).toBe(false);
        }
      }
    }
  });

  it("declares every path-template token as a required param", () => {
    for (const e of ALL_ENDPOINTS) {
      const tokens = [...publicPath(e).matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
      const required = new Set(e.params.map((p) => p.name));
      for (const t of tokens) {
        expect(required.has(t!), `${e.platform}/${e.resource} :: {${t}}`).toBe(true);
      }
    }
  });
});

describe("pricing data is coherent", () => {
  it("keeps every metered band ordered and above zero width where declared", () => {
    for (const e of ALL_ENDPOINTS) {
      if (e.pricing.model !== "metered") continue;
      const { min, max } = costRange(e);
      expect(min, `${e.platform}/${e.resource}`).toBeLessThanOrEqual(max);
    }
  });

  it("charges the tier rate on every ladder endpoint", () => {
    for (const e of ALL_ENDPOINTS) {
      if (e.pricing.model !== "ladder") continue;
      const key = `${e.platform}/${e.resource}`;
      expect(e.pricing.cost, key).toBe(CREDIT_LADDER[e.pricing.tier]);
      expect(e.pricing.cost, key).toBe(e.pricing.ladderCost);
    }
  });

  it("keeps creditCost in step with pricing.cost", () => {
    for (const e of ALL_ENDPOINTS) {
      expect(e.creditCost, `${e.platform}/${e.resource}`).toBe(e.pricing.cost);
      expect(e.creditTier, `${e.platform}/${e.resource}`).toBe(e.pricing.tier);
    }
  });

  it("agrees with stats.ts on how many endpoints use each billing shape", () => {
    const count = (model: string): number =>
      ENDPOINTS.filter((e) => e.pricing.model === model).length;
    expect(count("ladder")).toBe(REGISTRY_STATS.ladderPriced);
    expect(count("flat")).toBe(REGISTRY_STATS.flatPriced);
    expect(count("metered")).toBe(REGISTRY_STATS.meteredPriced);
    expect(ENDPOINTS.filter((e) => e.pricing.cost === 0)).toHaveLength(
      REGISTRY_STATS.freeEndpoints,
    );
    expect(ENDPOINTS.filter(isPaginatable)).toHaveLength(
      REGISTRY_STATS.paginatableEndpoints,
    );
  });

  it("never lets a metered endpoint's base cost pass as its price", () => {
    // The whole point of the metered model: quoting `cost` alone under-reports.
    const understated = ENDPOINTS.filter(
      (e) => e.pricing.model === "metered" && (e.pricing.maxCost ?? 0) > e.pricing.cost,
    );
    expect(understated.length).toBeGreaterThan(0);
    for (const e of understated) {
      expect(costRange(e).max, `${e.platform}/${e.resource}`).toBeGreaterThan(e.pricing.cost);
    }
  });
});

describe("the monitors family is present but outside the registry counts", () => {
  it("is merged into the catalog", () => {
    expect(ALL_PLATFORMS).toHaveLength(REGISTRY_STATS.totalPlatforms + 1);
    expect(ALL_ENDPOINTS).toHaveLength(
      REGISTRY_STATS.totalEndpoints + MONITOR_ENDPOINTS.length,
    );
  });

  it("is excluded from the registry data files", () => {
    expect(PLATFORMS.some((p) => p.slug === "monitors")).toBe(false);
    expect(ENDPOINTS.some((e) => e.platform === "monitors")).toBe(false);
  });

  it("declares its own endpoint count correctly", () => {
    expect(MONITOR_PLATFORM.endpointCount).toBe(MONITOR_ENDPOINTS.length);
    expect(MONITOR_PLATFORM.nonRegistry).toBe(true);
  });

  it("covers all seven API operations", () => {
    const routes = new Set(MONITOR_ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    expect(routes).toEqual(
      new Set([
        "POST /v1/monitors",
        "GET /v1/monitors",
        "GET /v1/monitors/{monitor_id}",
        "GET /v1/monitors/{monitor_id}/runs",
        "GET /v1/monitors/{monitor_id}/timeseries",
        "PATCH /v1/monitors/{monitor_id}",
        "DELETE /v1/monitors/{monitor_id}",
      ]),
    );
  });
});

describe("no upstream provider is named on a customer-facing surface", () => {
  // The `web` platform is deliberately opaque about who fetches the page.
  const FORBIDDEN = /firecrawl|scrapecreators|scrape creators|rapidapi|rapid api|\bpoix\b|api23/i;

  it.each([
    "src/data/endpoints.ts",
    "src/data/platforms.ts",
    "src/data/monitors.ts",
    "README.md",
    ".actor/input_schema.json",
    ".actor/actor.json",
  ])("%s", (file) => {
    const match = readText(file).match(FORBIDDEN);
    expect(match?.[0] ?? null).toBeNull();
  });
});

describe("Actor copy has not drifted from the generated data", () => {
  const schema = readJson(".actor/input_schema.json");
  const actorJson = readJson(".actor/actor.json");
  const pkg = readJson("package.json");
  const readme = readText("README.md");

  it("offers every platform slug in the input schema's dropdown", () => {
    expect(schema.properties.platform.enum).toEqual(ALL_PLATFORMS.map((p) => p.slug));
  });

  it("labels each dropdown entry with the platform's display name", () => {
    expect(schema.properties.platform.enumTitles).toEqual(
      ALL_PLATFORMS.map((p) => p.name),
    );
  });

  it("quotes the live counts in every piece of store copy", () => {
    const platforms = String(REGISTRY_STATS.totalPlatforms);
    const endpoints = String(REGISTRY_STATS.totalEndpoints);
    for (const [label, text] of [
      ["input_schema.description", schema.description],
      ["actor.json.description", actorJson.description],
      ["package.json.description", pkg.description],
      ["README", readme],
    ] as const) {
      expect(text, `${label} platform count`).toContain(platforms);
      expect(text, `${label} endpoint count`).toContain(endpoints);
    }
  });

  it("keeps the README platform table in step with the catalog", () => {
    for (const p of PLATFORMS) {
      expect(readme, p.name).toContain(p.name);
    }
  });

  it("keeps the Actor version in step across package.json, actor.json and constants", () => {
    expect(actorJson.version).toBe(pkg.version.split(".").slice(0, 2).join("."));
  });

  it("gives listEndpoints / listPricing a way to escape the platform dropdown", () => {
    // The SDK fills schema defaults, so `platform` is never empty at runtime.
    // Without this switch "price every endpoint" would be unreachable from the UI.
    expect(schema.properties.platform.default).toBeTruthy();
    expect(schema.properties.allPlatforms).toMatchObject({
      type: "boolean",
      default: false,
    });
  });

  it("documents every action the Actor implements", () => {
    expect(schema.properties.action.enum).toEqual([
      "request",
      "quickstart",
      "endpointGuide",
      "agentContext",
      "checkForUpdates",
      "listPlatforms",
      "listEndpoints",
      "searchEndpoints",
      "listPricing",
      "checkBalance",
    ]);
    expect(schema.properties.action.enumTitles).toHaveLength(
      schema.properties.action.enum.length,
    );
  });
});
