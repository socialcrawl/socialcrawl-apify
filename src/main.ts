import { Actor } from "apify";
import { PLATFORMS } from "./data/platforms.js";
import { ENDPOINTS, getEndpointsByPlatform } from "./data/endpoints.js";
import { callApi, type ClientConfig } from "./client.js";
import { validateRequest } from "./validate.js";
import { cleanParams, rowsFromEnvelope } from "./transform.js";
import { pricingFor, pricingNote, PRICING_SUMMARY } from "./pricing.js";
import { DEFAULT_BASE_URL, SIGNUP_URL } from "./constants.js";
import type { HttpMethod, SocialCrawlSuccessResponse } from "./types.js";

type Action =
  | "request"
  | "listPlatforms"
  | "listEndpoints"
  | "listPricing"
  | "checkBalance";

interface ActorInput {
  action?: Action;
  apiKey?: string;
  platform?: string;
  resource?: string;
  method?: HttpMethod;
  params?: Record<string, unknown>;
  idempotencyKey?: string;
  baseUrl?: string;
}

await Actor.init();

try {
  const input = ((await Actor.getInput()) ?? {}) as ActorInput;
  const action: Action = input.action ?? "request";
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const method = (input.method?.trim() || undefined) as HttpMethod | undefined;

  // ── Offline discovery actions (no API key needed) ──────────────────────
  if (action === "listPlatforms") {
    const rows = PLATFORMS.map((p) => ({
      platform: p.slug,
      name: p.name,
      endpoints: p.endpointCount,
      description: p.description,
    }));
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", { action, platforms: rows });
    await Actor.setStatusMessage(`Listed ${rows.length} platforms.`);
    await Actor.exit();
  }

  if (action === "listEndpoints") {
    const platform = (input.platform ?? "").trim();
    if (!platform) {
      await failGracefully('Action "List endpoints" requires a `platform` (e.g. "tiktok").');
    }
    const endpoints = getEndpointsByPlatform(platform);
    if (endpoints.length === 0) {
      await failGracefully(
        `No endpoints found for platform "${platform}". Run action "List platforms" to see valid slugs.`,
      );
    }
    const rows = endpoints.map((e) => ({
      platform: e.platform,
      resource: e.resource,
      method: e.method,
      public_path: `/v1/${e.platform}/${e.resource}`,
      credit_cost: e.creditCost,
      credit_tier: e.creditTier,
      pricing_note: pricingNote(e),
      archetype: e.archetype,
      summary: e.summary,
      required_params: e.params.map((p) => p.name),
      one_of_params: e.oneOfGroups,
      optional_params: e.optionalParams.map((p) => p.name),
    }));
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", { action, platform, endpoints: rows });
    await Actor.setStatusMessage(`Listed ${rows.length} endpoints for ${platform}.`);
    await Actor.exit();
  }

  if (action === "listPricing") {
    const platform = (input.platform ?? "").trim();
    const source = platform
      ? ENDPOINTS.filter((e) => e.platform === platform)
      : ENDPOINTS;
    if (platform && source.length === 0) {
      await failGracefully(
        `No endpoints found for platform "${platform}". Run action "List platforms" to see valid slugs, or leave platform blank to price every endpoint.`,
      );
    }
    const rows = source.map(pricingFor);
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", {
      action,
      ...(platform ? { platform } : {}),
      count: rows.length,
      pricing_summary: PRICING_SUMMARY,
      endpoints: rows,
    });
    await Actor.setStatusMessage(
      `Priced ${rows.length} endpoint(s)${platform ? ` for ${platform}` : " across all platforms"}.`,
    );
    await Actor.exit();
  }

  // ── Actions that need the API key ──────────────────────────────────────
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey) {
    // A zero-config run (default action, no key yet) should SUCCEED and be
    // useful rather than hard-fail — so the very first "Start" click, and
    // Apify's automated test run, both produce output. We show the platform
    // catalog and point the user at signup. `checkBalance` still requires a key.
    if (action === "request") {
      const rows = PLATFORMS.map((p) => ({
        platform: p.slug,
        name: p.name,
        endpoints: p.endpointCount,
        description: p.description,
      }));
      await Actor.pushData(rows);
      await Actor.setValue("OUTPUT", {
        note: `No API key provided yet — showing the ${rows.length}-platform catalog. Add your SocialCrawl API key to the "apiKey" input to fetch data. Get one free (100 credits, no card) at ${SIGNUP_URL}.`,
        platforms: rows,
      });
      await Actor.setStatusMessage(
        `No API key yet — listed ${rows.length} platforms. Add your SocialCrawl key (free at socialcrawl.dev) to fetch data.`,
      );
      await Actor.exit();
    }
    await failGracefully(
      `No API key provided. Paste your SocialCrawl API key (sc_…) into the "apiKey" input. Get one free (100 credits, no card) at ${SIGNUP_URL}.`,
    );
  }
  const config: ClientConfig = { apiKey, baseUrl };

  if (action === "checkBalance") {
    const result = await callApi(config, { platform: "meta", resource: "credits/balance" });
    if (!result.ok) {
      await failGracefully(result.errorMessage ?? "Failed to fetch balance.");
    }
    const data = (result.json as SocialCrawlSuccessResponse | null)?.data ?? result.json;
    await Actor.pushData({ action, balance: data });
    await Actor.setValue("OUTPUT", result.json);
    await Actor.setStatusMessage("Fetched credit balance.");
    await Actor.exit();
  }

  // ── Default action: make an API request ────────────────────────────────
  const platform = (input.platform ?? "").trim();
  const resource = (input.resource ?? "").trim();
  if (!platform || !resource) {
    await failGracefully(
      'Both `platform` (e.g. "tiktok") and `resource` (e.g. "profile") are required for a request. Run action "List endpoints" to discover resources.',
    );
  }

  const params = cleanParams(input.params);

  // Local validation — saves credits on obviously malformed calls, and resolves
  // the exact endpoint (method + credit cost) from the bundled registry.
  const validation = validateRequest(platform, resource, params, method);
  if (!validation.valid) {
    await failGracefully(validation.error ?? "Invalid request.");
  }
  const resolved = validation.endpoint!;

  await Actor.setStatusMessage(
    `Calling ${resolved.method} /v1/${platform}/${resource} (${resolved.creditCost} credit${resolved.creditCost === 1 ? "" : "s"})…`,
  );

  const result = await callApi(config, {
    platform,
    resource,
    method: resolved.method,
    params,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
  });

  if (!result.ok) {
    await failGracefully(result.errorMessage ?? `Request failed (HTTP ${result.status}).`);
  }

  const envelope = result.json as SocialCrawlSuccessResponse | null;
  const rows = rowsFromEnvelope(platform, resource, envelope, result.raw, result.path);
  await Actor.pushData(rows);

  // Persist the full, untouched envelope so credit meta + nested data are never lost.
  await Actor.setValue("OUTPUT", envelope ?? { raw: result.raw });

  const used = envelope?.credits_used ?? 0;
  const remaining = envelope?.credits_remaining ?? "?";
  const cached = envelope?.cached ? " (cache hit — 0 charged)" : "";
  await Actor.setStatusMessage(
    `Done. ${rows.length} item(s). Credits used: ${used}${cached}. Remaining: ${remaining}.`,
  );

  await Actor.exit();
} catch (err) {
  // Anything unexpected: fail the run with a readable message.
  await Actor.fail(err instanceof Error ? err.message : String(err));
}

/** Push a structured error to the dataset, set OUTPUT, and exit non-fatally. */
async function failGracefully(message: string): Promise<never> {
  await Actor.pushData({ error: message });
  await Actor.setValue("OUTPUT", { success: false, error: message });
  await Actor.setStatusMessage(message);
  await Actor.exit({ exitCode: 1 });
  // Actor.exit() terminates the process; this satisfies the `never` return type.
  throw new Error(message);
}
