import { Actor, log } from "apify";
import {
  ALL_ENDPOINTS,
  ALL_PLATFORMS,
  getEndpointsByPlatform,
  publicPath,
  searchEndpoints,
} from "./catalog.js";
import { callApi, resolvePath, type ClientConfig } from "./client.js";
import { DEFAULT_BASE_URL, SIGNUP_URL } from "./constants.js";
import { prepareMonitorBody } from "./data/monitors.js";
import { REGISTRY_STATS } from "./data/stats.js";
import { explainStop, runPaginated } from "./paginate.js";
import {
  cacheNote,
  costRange,
  estimateRunCost,
  PRICING_SUMMARY,
  pricingFor,
  pricingNote,
} from "./pricing.js";
import { cleanParams, rowsFromEnvelope } from "./transform.js";
import {
  callUtility,
  compareCatalog,
  summarizeDrift,
  type AgentContext,
  type EndpointCatalog,
} from "./utility.js";
import { validateRequest } from "./validate.js";
import type { Endpoint, HttpMethod, SocialCrawlSuccessResponse } from "./types.js";

type Action =
  | "request"
  | "quickstart"
  | "endpointGuide"
  | "agentContext"
  | "checkForUpdates"
  | "listPlatforms"
  | "listEndpoints"
  | "searchEndpoints"
  | "listPricing"
  | "checkBalance";

/**
 * Actions served by the API's own `utility` platform rather than the bundled
 * snapshot. Free (0 credits) but authed, like every /v1 route.
 */
const LIVE_DX_ACTIONS = new Set<Action>([
  "quickstart",
  "endpointGuide",
  "agentContext",
  "checkForUpdates",
]);

interface ActorInput {
  action?: Action;
  apiKey?: string;
  platform?: string;
  resource?: string;
  method?: HttpMethod;
  params?: Record<string, unknown>;
  query?: string;
  format?: "markdown" | "json";
  allPlatforms?: boolean;
  maxItems?: number;
  maxPages?: number;
  dryRun?: boolean;
  idempotencyKey?: string;
  baseUrl?: string;
}

/** Safety ceiling on billed page requests, whatever `maxPages` is set to. */
const HARD_PAGE_CAP = 500;

await Actor.init();

try {
  const input = ((await Actor.getInput()) ?? {}) as ActorInput;
  const action: Action = input.action ?? "request";
  const baseUrl = (input.baseUrl?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const method = (input.method?.trim() || undefined) as HttpMethod | undefined;
  // The platform dropdown carries a schema default and the Apify SDK fills it
  // in, so it is NEVER empty — "leave it blank for everything" is not a thing a
  // user can express. `allPlatforms` is the explicit opt-out.
  const allPlatforms = input.allPlatforms === true;

  // ── Offline discovery actions (no API key needed) ──────────────────────
  if (action === "listPlatforms") {
    const rows = ALL_PLATFORMS.map((p) => ({
      platform: p.slug,
      name: p.name,
      endpoints: p.endpointCount,
      social: p.social,
      category: p.category ?? null,
      registry: !p.nonRegistry,
      description: p.description,
    }));
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", {
      action,
      registry_totals: REGISTRY_STATS,
      pricing_summary: PRICING_SUMMARY,
      platforms: rows,
    });
    await Actor.setStatusMessage(
      `Listed ${rows.length} platforms (${REGISTRY_STATS.totalEndpoints} registry endpoints + the monitors family).`,
    );
    await Actor.exit();
  }

  if (action === "listEndpoints") {
    const platform = (input.platform ?? "").trim();
    if (!allPlatforms && !platform) {
      await failGracefully(
        'Action "List endpoints" requires a `platform` (e.g. "tiktok"), or tick `allPlatforms` for the whole catalog. Run action "List platforms" to see every slug.',
      );
    }
    const endpoints = allPlatforms ? ALL_ENDPOINTS : getEndpointsByPlatform(platform);
    if (endpoints.length === 0) {
      await failGracefully(
        `No endpoints found for platform "${platform}". Run action "List platforms" to see valid slugs, or tick \`allPlatforms\`.`,
      );
    }
    const rows = endpoints.map(describeEndpoint);
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", {
      action,
      ...(allPlatforms ? { scope: "all platforms" } : { platform }),
      count: rows.length,
      pricing_summary: PRICING_SUMMARY,
      endpoints: rows,
    });
    await Actor.setStatusMessage(
      `Listed ${rows.length} endpoints ${allPlatforms ? "across every platform" : `for ${platform}`}.`,
    );
    await Actor.exit();
  }

  if (action === "searchEndpoints") {
    const query = (input.query ?? "").trim();
    if (!query) {
      await failGracefully(
        'Action "Search endpoints" requires a `query` (e.g. "comments", "product reviews", "transcript").',
      );
    }
    const matches = searchEndpoints(query);
    if (matches.length === 0) {
      await failGracefully(
        `No endpoints matched "${query}". Try a single broader keyword, or run action "List platforms" to browse.`,
      );
    }
    const rows = matches.map(describeEndpoint);
    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", { action, query, count: rows.length, endpoints: rows });
    await Actor.setStatusMessage(
      `Found ${rows.length} endpoint(s) matching "${query}" across ${ALL_ENDPOINTS.length} endpoints.`,
    );
    await Actor.exit();
  }

  if (action === "listPricing") {
    const platform = (input.platform ?? "").trim();
    const source =
      allPlatforms || !platform
        ? ALL_ENDPOINTS
        : ALL_ENDPOINTS.filter((e) => e.platform === platform);
    if (!allPlatforms && platform && source.length === 0) {
      await failGracefully(
        `No endpoints found for platform "${platform}". Run action "List platforms" to see valid slugs, or tick \`allPlatforms\` to price every endpoint.`,
      );
    }
    const rows = source.map(pricingFor);
    const metered = rows.filter((r) => r.is_metered).length;
    await Actor.pushData(rows);
    const scoped = !allPlatforms && platform;
    await Actor.setValue("OUTPUT", {
      action,
      ...(scoped ? { platform } : { scope: "all platforms" }),
      count: rows.length,
      pricing_summary: PRICING_SUMMARY,
      endpoints: rows,
    });
    await Actor.setStatusMessage(
      `Priced ${rows.length} endpoint(s)${scoped ? ` for ${platform}` : " across all platforms"} — ${metered} of them metered (budget against max_credits).`,
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
      const rows = ALL_PLATFORMS.map((p) => ({
        platform: p.slug,
        name: p.name,
        endpoints: p.endpointCount,
        description: p.description,
      }));
      await Actor.pushData(rows);
      await Actor.setValue("OUTPUT", {
        note: `No API key provided yet — showing the ${rows.length}-platform catalog. Add your SocialCrawl API key to the "apiKey" input to fetch data. Get one free (100 credits, no card) at ${SIGNUP_URL}.`,
        next_step: 'With a key, run action "Quickstart" first: it returns auth, the response envelope, the credit model, the full error taxonomy and a first working call — from the live API, for 0 credits.',
        registry_totals: REGISTRY_STATS,
        platforms: rows,
      });
      await Actor.setStatusMessage(
        `No API key yet — listed ${rows.length} platforms. Add your SocialCrawl key (free at socialcrawl.dev), then run action "Quickstart" to learn the API for 0 credits.`,
      );
      await Actor.exit();
    }
    if (LIVE_DX_ACTIONS.has(action)) {
      await failGracefully(
        `"${action}" costs 0 credits, but every SocialCrawl route is authenticated, so it still needs a key in the "apiKey" input. Get one free (100 credits, no card) at ${SIGNUP_URL}. To browse without a key, use "List platforms", "List endpoints", "Search endpoints" or "List pricing" — those answer from the Actor's bundled catalog.`,
      );
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

  // ── Live Developer-Experience actions (utility platform, 0 credits) ───
  // These answer from the LIVE registry, not this Actor's bundled snapshot,
  // so they are the right thing to reach for when "is my understanding of the
  // API current?" is the actual question.

  if (action === "quickstart") {
    // The platform dropdown always carries a value, so `allPlatforms` is how a
    // user asks for the whole-API quickstart rather than a tailored one.
    const scope = allPlatforms ? "" : (input.platform ?? "").trim();
    const result = await callUtility(config, "quickstart", scope ? { platform: scope } : {});
    if (!result.ok) await failGracefully(result.errorMessage!);

    const data = (result.data ?? {}) as Record<string, any>;
    await Actor.pushData({
      kind: "quickstart",
      ...(scope ? { scoped_to: scope } : {}),
      base_url: data.base_url ?? null,
      auth: data.auth ?? null,
      first_call: data.first_call ?? null,
      billing: data.billing ?? null,
      pagination: data.pagination ?? null,
      rate_limits: data.rate_limits ?? null,
      stats: data.stats ?? null,
      next_steps: data.next_steps ?? null,
      envelope_shape: data.envelope ?? null,
    });
    // Every error code as its own row: this is the table a caller actually
    // needs open while writing retry and refund handling.
    for (const err of (data.errors ?? []) as Record<string, unknown>[]) {
      await Actor.pushData({ kind: "error_code", ...err });
    }
    await Actor.setValue("OUTPUT", result.envelope);

    const errorCount = (data.errors ?? []).length;
    await Actor.setStatusMessage(
      `Quickstart${scope ? ` for ${scope}` : ""}: auth, envelope, billing, pagination, rate limits and ${errorCount} error codes — straight from the live API, 0 credits.`,
    );
    await Actor.exit();
  }

  if (action === "endpointGuide") {
    // Accept the Actor's own platform/resource inputs, or a raw id/url pasted
    // into params — the form every `how_to_use` link in the API already uses.
    const raw = cleanParams(input.params);
    const explicitId = typeof raw.id === "string" ? raw.id.trim() : "";
    const explicitUrl = typeof raw.url === "string" ? raw.url.trim() : "";
    const platformInput = (input.platform ?? "").trim();
    const resourceInput = (input.resource ?? "").trim();

    const query: Record<string, unknown> = {};
    if (explicitId) query.id = explicitId;
    else if (explicitUrl) query.url = explicitUrl;
    else if (platformInput && resourceInput) query.id = `${platformInput}/${resourceInput}`;
    else {
      await failGracefully(
        'Action "Endpoint guide" needs an endpoint. Set `platform` + `resource` (e.g. tiktok + profile), or pass {"id": "tiktok/profile"} or {"url": "/v1/tiktok/profile"} in `params`.',
      );
    }
    if (method) query.method = method;

    const result = await callUtility(config, "endpoint", query);
    if (!result.ok) {
      await failGracefully(
        `${result.errorMessage} (asked for ${JSON.stringify(query)}). Run action "Search endpoints" to find the right id.`,
      );
    }

    const guide = (result.data ?? {}) as Record<string, any>;
    // The payload already carries `kind: "endpoint_guide"`; the fallback is
    // only for a response that somehow arrives without it.
    await Actor.pushData({ ...guide, kind: guide.kind ?? "endpoint_guide" });
    await Actor.setValue("OUTPUT", result.envelope);

    const curl = guide.request?.curl;
    if (typeof curl === "string") {
      // A copy-paste artefact, not something to dig out of a JSON blob.
      await Actor.setValue("REQUEST_CURL", curl, { contentType: "text/plain; charset=utf-8" });
    }
    await Actor.setStatusMessage(
      `Guide for ${guide.method ?? ""} ${guide.path ?? query.id ?? query.url} — ${guide.credits?.label ?? "?"} credits, ${(guide.params?.optional ?? []).length} optional param(s). Copy-paste curl saved to REQUEST_CURL. 0 credits.`,
    );
    await Actor.exit();
  }

  if (action === "agentContext") {
    const scope = allPlatforms ? "" : (input.platform ?? "").trim();
    const format = input.format === "json" ? "json" : "markdown";
    const result = await callUtility<AgentContext>(config, "llms", {
      ...(scope ? { platform: scope } : {}),
      format,
    });
    if (!result.ok) await failGracefully(result.errorMessage!);

    const data = result.data;
    await Actor.setValue("OUTPUT", result.envelope);

    if (format === "markdown") {
      const content = data?.content ?? "";
      // This corpus exists to be fed to a model or committed to a repo, so it
      // is saved as a real .md file rather than a JSON-escaped string.
      await Actor.setValue("AGENT_CONTEXT.md", content, {
        contentType: "text/markdown; charset=utf-8",
      });
      await Actor.pushData({
        kind: "agent_context",
        format,
        scope: data?.scope ?? scope ?? "all",
        characters: content.length,
        links: data?.links ?? null,
        content,
      });
      await Actor.setStatusMessage(
        `Agent context (${data?.scope ?? "all"}, markdown): ${content.length} characters saved to the key-value store as AGENT_CONTEXT.md. 0 credits.`,
      );
    } else {
      await Actor.pushData({
        kind: "agent_context",
        format,
        scope: data?.scope ?? scope ?? "all",
        ...(data?.context ?? {}),
      });
      await Actor.setStatusMessage(
        `Agent context (${data?.scope ?? "all"}, structured JSON) fetched from the live API. 0 credits.`,
      );
    }
    await Actor.exit();
  }

  if (action === "checkForUpdates") {
    const result = await callUtility<EndpointCatalog>(config, "endpoints");
    if (!result.ok) await failGracefully(result.errorMessage!);

    const live = result.data?.endpoints ?? [];
    if (live.length === 0) {
      await failGracefully(
        "The live catalog came back empty, so there is nothing to compare against. Nothing was changed.",
      );
    }

    const report = compareCatalog(live);
    const summary = summarizeDrift(report);

    if (report.in_sync) {
      await Actor.pushData({
        kind: "catalog_drift",
        in_sync: true,
        api_endpoints: report.api_endpoints,
        actor_endpoints: report.actor_endpoints,
        detail: summary,
      });
    } else {
      for (const { kind, ...finding } of report.findings) {
        // `kind` is renamed to `difference` so it does not collide with the
        // row-type discriminator every other action uses.
        await Actor.pushData({
          kind: "catalog_drift",
          in_sync: false,
          difference: kind,
          ...finding,
        });
      }
    }

    await Actor.setValue("OUTPUT", {
      action,
      ...report,
      summary,
      note: "The live API is authoritative. Where they differ, trust the API — this Actor validates against a catalog bundled at release time.",
      live_stats: result.data?.stats ?? null,
    });
    await Actor.setStatusMessage(summary);
    await Actor.exit();
  }

  // ── Default action: make an API request ────────────────────────────────
  const platform = (input.platform ?? "").trim();
  const resource = (input.resource ?? "").trim();
  if (!platform || !resource) {
    await failGracefully(
      'Both `platform` (e.g. "tiktok") and `resource` (e.g. "profile") are required for a request. Run action "Search endpoints" or "List endpoints" to discover resources.',
    );
  }

  let params = cleanParams(input.params);
  if (platform === "monitors") params = prepareMonitorBody(params);

  // Local validation — saves credits on obviously malformed calls, and resolves
  // the exact endpoint (method, pricing band, pagination) from the bundled
  // registry snapshot.
  const validation = validateRequest(platform, resource, params, method);
  for (const warning of validation.warnings) {
    log.warning(warning);
  }
  if (!validation.valid) {
    await failGracefully(
      `${validation.error ?? "Invalid request."} For exact instructions on this endpoint — every parameter, a copy-paste curl, and an example response — run action "Endpoint guide" with platform "${platform}" and resource "${resource}" (free).`,
    );
  }
  const endpoint = validation.endpoint!;

  // Resources that pin a body field (monitors pause/resume) inject it here, so
  // the user never has to know the wire shape.
  if (endpoint.fixedParams) params = { ...params, ...endpoint.fixedParams };

  const canPage = Boolean(endpoint.pagination) && !endpoint.singlePage;
  const requestedMaxItems = Math.max(0, Math.floor(input.maxItems ?? 0));
  const maxItems = canPage ? requestedMaxItems : 0;
  const maxPages = Math.min(
    HARD_PAGE_CAP,
    Math.max(1, Math.floor(input.maxPages ?? HARD_PAGE_CAP)),
  );

  if (requestedMaxItems > 0 && !canPage) {
    log.warning(
      `maxItems was set, but ${publicPath(endpoint)} serves a single page — making one request.`,
    );
  }

  const plannedPages = maxItems > 0 ? maxPages : 1;
  const estimate = estimateRunCost(endpoint, plannedPages);

  // ── Dry run: report the resolved call and its price, spend nothing ────
  if (input.dryRun) {
    const plan = {
      action: "dryRun",
      request: (() => {
        // Both forms: the template names the route, the resolved path is the
        // exact URL the run would hit. Path tokens are consumed by the URL, so
        // show the remainder separately — that is what rides the query string
        // (GET/DELETE) or the JSON body (POST/PATCH).
        const { path, consumed } = resolvePath(
          endpoint.platform,
          endpoint.resource,
          params,
          endpoint.path,
        );
        const rest = Object.fromEntries(
          Object.entries(params).filter(([k]) => !consumed.includes(k)),
        );
        return {
          method: endpoint.method,
          path_template: publicPath(endpoint),
          path,
          [endpoint.method === "POST" || endpoint.method === "PATCH"
            ? "body"
            : "query"]: rest,
          params,
        };
      })(),
      pricing: pricingFor(endpoint),
      auto_pagination: {
        supported: canPage,
        enabled: maxItems > 0,
        max_items: maxItems || null,
        max_pages: maxItems > 0 ? maxPages : 1,
      },
      cost_estimate: {
        min_credits: estimate.min,
        max_credits: estimate.max,
        explanation: estimate.text,
      },
      warnings: validation.warnings,
      note: "Dry run — nothing was called and no credits were spent. Clear the `dryRun` input to execute.",
    };
    await Actor.pushData(plan);
    await Actor.setValue("OUTPUT", plan);
    await Actor.setStatusMessage(
      `Dry run OK — ${endpoint.method} ${publicPath(endpoint)} would cost ${estimate.text}. No credits spent.`,
    );
    await Actor.exit();
  }

  await Actor.setStatusMessage(
    `Calling ${endpoint.method} ${publicPath(endpoint)} — ${estimate.text}…`,
  );

  const envelopes: unknown[] = [];
  let totalRows = 0;

  const summary = await runPaginated(config, endpoint, params, {
    maxItems,
    maxPages,
    idempotencyKey: input.idempotencyKey?.trim() || undefined,
    onPage: async (page) => {
      const rows = rowsFromEnvelope(
        endpoint.platform,
        endpoint.resource,
        page.envelope,
        page.result.raw,
        page.result.path,
        maxItems > 0 ? { pageIndex: page.pageIndex } : {},
      );
      totalRows += rows.length;
      await Actor.pushData(rows);
      envelopes.push(page.envelope ?? { raw: page.result.raw });
      if (maxItems > 0) {
        await Actor.setStatusMessage(
          `Page ${page.pageIndex + 1}: ${totalRows} item(s) so far…`,
        );
      }
    },
  });

  if (summary.stopReason === "error" && summary.pages === 0) {
    await failGracefully(summary.errorMessage ?? "Request failed.");
  }

  // Persist the full, untouched envelope(s) so credit meta + nested data are
  // never lost. A single-page run keeps the bare envelope for compatibility.
  await Actor.setValue(
    "OUTPUT",
    envelopes.length === 1
      ? envelopes[0]
      : {
          pages: summary.pages,
          items: summary.items,
          credits_used: summary.creditsUsed,
          next_cursor: summary.nextCursor,
          stop_reason: summary.stopReason,
          envelopes,
        },
  );

  const last = envelopes[envelopes.length - 1] as SocialCrawlSuccessResponse | undefined;
  const remaining = last?.credits_remaining ?? "?";
  const cached = summary.creditsUsed === 0 ? " (cache hit / free — 0 charged)" : "";
  const pageNote = summary.pages > 1 ? ` across ${summary.pages} pages` : "";
  const stopNote =
    summary.stopReason === "error"
      ? ` Stopped early: ${summary.errorMessage}`
      : maxItems > 0
        ? ` ${explainStop(endpoint, summary)}`
        : "";

  await Actor.setStatusMessage(
    `Done. ${totalRows} item(s)${pageNote}. Credits used: ${summary.creditsUsed}${cached}. Remaining: ${remaining}.${stopNote}`,
  );

  await Actor.exit();
} catch (err) {
  // Anything unexpected: fail the run with a readable message.
  await Actor.fail(err instanceof Error ? err.message : String(err));
}

/**
 * The full public description of one endpoint — every parameter with its type,
 * constraints, description and example, plus the pricing band, the cache
 * window, and whether it can be auto-paginated. This is what makes the
 * discovery actions enough to build a correct call without leaving Apify.
 */
function describeEndpoint(e: Endpoint): Record<string, unknown> {
  const { min, max } = costRange(e);
  return {
    platform: e.platform,
    resource: e.resource,
    method: e.method,
    public_path: publicPath(e),
    summary: e.summary,
    description: e.description,
    archetype: e.archetype,
    ...(e.family ? { family: e.family } : {}),
    ...(e.group ? { group: e.group } : {}),
    ...(e.actionLabel ? { action_label: e.actionLabel } : {}),

    credit_tier: e.pricing.tier,
    credit_cost: e.pricing.cost,
    min_credits: min,
    max_credits: max,
    pricing_model: e.pricing.model,
    pricing_note: pricingNote(e),
    cache_ttl_seconds: e.cache.ttlSeconds,
    cache_note: cacheNote(e),

    required_params: e.params.map((p) => ({
      name: p.name,
      description: p.description,
      example: p.example,
    })),
    one_of_params: e.oneOfGroups,
    optional_params: e.optionalParams.map((p) => ({
      name: p.name,
      type: p.type,
      ...(p.enumValues ? { allowed_values: p.enumValues } : {}),
      ...(p.minimum !== undefined ? { minimum: p.minimum } : {}),
      ...(p.maximum !== undefined ? { maximum: p.maximum } : {}),
      ...(p.requires ? { requires: p.requires } : {}),
      ...(p.couplesWith
        ? { requires_value: `${p.couplesWith.param}=${p.couplesWith.value}` }
        : {}),
      ...(p.in ? { sent_in: p.in } : {}),
      ...(p.description ? { description: p.description } : {}),
      ...(p.example ? { example: p.example } : {}),
    })),
    ...(e.csvConstraints ? { list_param_limits: e.csvConstraints } : {}),

    paginatable: Boolean(e.pagination) && !e.singlePage,
    ...(e.pagination ? { pagination_style: e.pagination.style } : {}),
    ...(e.pagination?.limitMax !== undefined
      ? { max_page_size: e.pagination.limitMax }
      : {}),
    ...(e.singlePage ? { single_page_reason: e.singlePage } : {}),
    ...(e.collectUntilN ? { server_side_collection: e.collectUntilN } : {}),
    ...(e.execution ? { execution: e.execution } : {}),
    ...(e.emptyOn404 ? { empty_result_is_not_an_error: true } : {}),
    ...(e.contractDetails?.length ? { contract_details: e.contractDetails } : {}),
  };
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
