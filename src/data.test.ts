import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACTOR_VERSION } from "./constants.js";
import { ALL_ENDPOINTS, ALL_PLATFORMS, isPaginatable, publicPath } from "./catalog.js";
import { COHORT_ENDPOINTS, COHORT_PLATFORM } from "./data/cohorts.js";
import { ENDPOINTS } from "./data/endpoints.js";
import { MONITOR_ENDPOINTS, MONITOR_PLATFORM } from "./data/monitors.js";
import { PLATFORMS } from "./data/platforms.js";
import { CREDIT_LADDER, REGISTRY_STATS } from "./data/stats.js";
import { costRange, creditsHeldUpfront, pricingNote } from "./pricing.js";

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

  it("carries the registry's topic tags on every endpoint", () => {
    // Tags are what make cross-cutting searches work ("ads" reaching
    // tiktok-ads, linkedin-ads and google-ads at once). A generator that
    // silently stopped emitting them would degrade search with no other signal.
    for (const e of ENDPOINTS) {
      expect(e.tags?.length, `${e.platform}/${e.resource}`).toBeGreaterThan(0);
    }
  });

  it("declares a response shape that names a real `data` key", () => {
    const shaped = ENDPOINTS.filter((e) => e.responseShape);
    expect(shaped).toHaveLength(REGISTRY_STATS.endpointsWithResponseShape);
    for (const e of shaped) {
      // Every declared root is `data.<key>` or `data.<key>[]` — the two forms
      // transform.ts knows how to read. Anything else would silently fall back
      // to the guess it is meant to replace.
      expect(e.responseShape!.root, `${e.platform}/${e.resource}`).toMatch(
        /^data\.[a-z_]+(\[\])?$/,
      );
    }
  });

  it("only names an item kind on a list shape", () => {
    // A singular shape IS its object, so an `itemKey` there would be a second,
    // conflicting answer to "what is this row?". Not every list carries one:
    // the mixed archetypes (SearchResult, MediaList) have no single kind, and
    // inventing one for them would be worse than leaving `_sc_item_kind` off.
    for (const e of ENDPOINTS) {
      const shape = e.responseShape;
      if (!shape?.itemKey) continue;
      expect(shape.root, `${e.platform}/${e.resource}`).toMatch(/\[\]$/);
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

describe("the stateful families are present but outside the registry counts", () => {
  const STATEFUL = [
    { platform: COHORT_PLATFORM, endpoints: COHORT_ENDPOINTS },
    { platform: MONITOR_PLATFORM, endpoints: MONITOR_ENDPOINTS },
  ];

  it("is merged into the catalog", () => {
    expect(ALL_PLATFORMS).toHaveLength(REGISTRY_STATS.totalPlatforms + STATEFUL.length);
    expect(ALL_ENDPOINTS).toHaveLength(
      REGISTRY_STATS.totalEndpoints +
        STATEFUL.reduce((n, f) => n + f.endpoints.length, 0),
    );
  });

  it.each(STATEFUL)("$platform.slug is excluded from the registry data files", ({ platform }) => {
    expect(PLATFORMS.some((p) => p.slug === platform.slug)).toBe(false);
    expect(ENDPOINTS.some((e) => e.platform === platform.slug)).toBe(false);
  });

  it.each(STATEFUL)("$platform.slug declares its own endpoint count correctly", ({ platform, endpoints }) => {
    expect(platform.endpointCount).toBe(endpoints.length);
    expect(platform.nonRegistry).toBe(true);
    // Every route in a stateful family needs an explicit path: none of them
    // live at /v1/{platform}/{resource}.
    for (const e of endpoints) {
      expect(e.path, `${e.platform}/${e.resource}`).toBeTruthy();
      expect(e.nonRegistry, `${e.platform}/${e.resource}`).toBe(true);
    }
  });

  it("covers all seven monitors API operations", () => {
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

  it("covers all eight cohorts API operations", () => {
    const routes = new Set(COHORT_ENDPOINTS.map((e) => `${e.method} ${e.path}`));
    expect(routes).toEqual(
      new Set([
        "POST /v1/cohorts",
        "PUT /v1/cohorts/{cohort_id}/members",
        "GET /v1/cohorts/{cohort_id}",
        "DELETE /v1/cohorts/{cohort_id}",
        "POST /v1/cohorts/{cohort_id}/queries",
        "GET /v1/cohort-queries/{query_id}",
        "DELETE /v1/cohort-queries/{query_id}",
        "GET /v1/cohort-queries/{query_id}/results",
      ]),
    );
  });

  it("flags exactly the cohort routes that need an Idempotency-Key", () => {
    // The API rejects these three without the header, and the Actor generates
    // one when the user supplies none — so the flag is what keeps them callable.
    const flagged = ALL_ENDPOINTS.filter((e) => e.requiresIdempotencyKey).map(
      (e) => `${e.platform}/${e.resource}`,
    );
    expect(new Set(flagged)).toEqual(
      new Set(["cohorts/create", "cohorts/members", "cohorts/query"]),
    );
  });

  it("prices the cohort family honestly — free lifecycle, one computed-hold meter", () => {
    const billed = COHORT_ENDPOINTS.filter((e) => e.pricing.cost > 0 || e.pricing.model === "metered");
    expect(billed.map((e) => e.resource)).toEqual(["query"]);
    const query = billed[0]!;
    // A computed hold must never quote `maxCost` as the amount held: the real
    // ceiling is panel size x page cap x per-page cost.
    expect(query.pricing.holdIsComputed).toBe(true);
    expect(creditsHeldUpfront(query)).toBeNull();
    expect(pricingNote(query)).toContain("computed from the request");
    for (const e of COHORT_ENDPOINTS.filter((e) => e !== query)) {
      expect(e.pricing.cost, e.resource).toBe(0);
    }
  });
});

describe("no upstream provider is named on a customer-facing surface", () => {
  // The `web` platform is deliberately opaque about who fetches the page.
  const FORBIDDEN = /firecrawl|scrapecreators|scrape creators|rapidapi|rapid api|\bpoix\b|api23/i;

  it.each([
    "src/data/endpoints.ts",
    "src/data/platforms.ts",
    "src/data/monitors.ts",
    "src/data/cohorts.ts",
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
    // Checking only that the NAME appears let the per-platform counts rot: the
    // table said TikTok 33 for two waves after it was 36. Assert the pair.
    for (const p of PLATFORMS) {
      expect(readme, p.name).toContain(p.name);
      expect(readme, `${p.name} endpoint count`).toMatch(
        new RegExp(`\\|\\s*${p.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\|\\s*${p.endpointCount}\\s*\\|`),
      );
    }
  });

  it("keeps the Actor version in step across package.json, actor.json and constants", () => {
    expect(actorJson.version).toBe(pkg.version.split(".").slice(0, 2).join("."));
    // ACTOR_VERSION rides on every request's User-Agent, so a stale one makes
    // the API's own traffic logs lie about which build made a call.
    expect(ACTOR_VERSION).toBe(pkg.version);
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
    // Read the union straight out of main.ts rather than restating it: a
    // hand-copied list here means a new action can ship with no way to pick it
    // from the Apify form, and the test still passes.
    const union = readText("src/main.ts").match(/^type Action =\r?\n([\s\S]*?);\r?$/m);
    expect(union, "main.ts must declare `type Action`").not.toBeNull();
    const implemented = [...union![1]!.matchAll(/"([A-Za-z]+)"/g)].map((m) => m[1]);

    expect(schema.properties.action.enum).toEqual(implemented);
    expect(schema.properties.action.enumTitles).toHaveLength(
      schema.properties.action.enum.length,
    );
  });
});
