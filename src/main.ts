import { randomUUID } from "node:crypto";
import { Actor, log } from "apify";
import {
  ALL_ENDPOINTS,
  ALL_PLATFORMS,
  getEndpointsByPlatform,
  getHydratableEndpoints,
  publicPath,
  searchEndpoints,
} from "./catalog.js";
import { callApi, resolvePath, type ClientConfig } from "./client.js";
import { DEFAULT_BASE_URL, SIGNUP_URL } from "./constants.js";
import { prepareCohortBody } from "./data/cohorts.js";
import { prepareMonitorBody } from "./data/monitors.js";
import { REGISTRY_STATS } from "./data/stats.js";
import {
  describeJoins,
  includeJoins,
  joinCostImpact,
  tokenCeiling,
} from "./hydration.js";
import { explainStop, runPaginated } from "./paginate.js";
import {
  cacheNote,
  costRange,
  costRangeForCall,
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
  | "listRowJoins"
  | "checkBalance"
  | "creditTransactions";

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
      `Listed ${rows.length} platforms (${REGISTRY_STATS.totalEndpoints} registry endpoints + the stateful monitors and cohorts families).`,
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
    const joined = rows.filter((r) => r.has_row_join).length;
    await Actor.setStatusMessage(
      `Priced ${rows.length} endpoint(s)${scoped ? ` for ${platform}` : " across all platforms"} — ${metered} of them metered (budget against max_credits)${joined > 0 ? `, ${joined} with an \`include=…\` row join that lifts the ceiling` : ""}.`,
    );
    await Actor.exit();
  }

  // ── Row joins: the endpoints where one call can do the work of many ───
  // `include=…` runs a second lookup against every row the endpoint returned
  // and bills only for the rows it actually filled. It is the single biggest
  // lever on both cost and call count, and the hardest thing to discover from
  // a flat endpoint list — so it gets its own free, key-less action.
  if (action === "listRowJoins") {
    const platform = (input.platform ?? "").trim();
    const all = getHydratableEndpoints();
    const source =
      allPlatforms || !platform ? all : all.filter((e) => e.platform === platform);
    if (source.length === 0) {
      await failGracefully(
        platform && !allPlatforms
          ? `No endpoint on platform "${platform}" offers an \`include=…\` row join. Tick \`allPlatforms\` to list all ${all.length} that do.`
          : "No row-joinable endpoints are present in this Actor's bundled catalog.",
      );
    }

    const rows = source.map((e) => {
      const plain = e.pricing.cost;
      const { max } = costRange(e);
      // The joins' own declared ceiling, NOT `max - plain`. On the four
      // endpoints that also meter for other reasons the two differ sharply —
      // `threads/user/posts` spans 1-165, but only 15 of that is the join.
      const joinCeiling = (e.hydration ?? []).reduce(
        (n, h) => n + tokenCeiling(h),
        0,
      );
      return {
        kind: "row_join",
        platform: e.platform,
        resource: e.resource,
        public_path: publicPath(e),
        summary: e.summary,
        plain_call_credits: plain,
        extra_credits_max: joinCeiling,
        joined_call_max_credits: plain + joinCeiling,
        /** The endpoint's whole band, which may include metering beyond the join. */
        endpoint_max_credits: max,
        applies_to: e.responseShape?.root.endsWith("items[]")
          ? "each row"
          : "the response",
        max_page_size: e.pagination?.limitMax ?? null,
        pricing_note: pricingNote(e),
        joins: describeJoins(e),
      };
    });

    await Actor.pushData(rows);
    await Actor.setValue("OUTPUT", {
      action,
      ...(allPlatforms || !platform ? { scope: "all platforms" } : { platform }),
      count: rows.length,
      how_it_works: PRICING_SUMMARY.row_joins,
      endpoints: rows,
    });
    await Actor.setStatusMessage(
      `${rows.length} endpoint(s) accept an \`include=…\` row join — one call instead of one per row. Each row shows the plain price, the joined ceiling, and what the join fills in. 0 credits.`,
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

  // ── Credit ledger: the dispute-grade receipt for every charge ─────────
  // Every deduction and refund, keyed by `request_id`, so a charge can be
  // reconciled against the exact request that produced it. Free, keyset-
  // paginated newest-first, and the only place `balance_after` is exposed.
  if (action === "creditTransactions") {
    const raw = cleanParams(input.params);
    const ledgerParams: Record<string, unknown> = {};
    const limit = Math.min(100, Math.max(1, Math.floor(Number(raw.limit ?? 50) || 50)));
    ledgerParams.limit = limit;
    if (typeof raw.request_id === "string" && raw.request_id.trim()) {
      ledgerParams.request_id = raw.request_id.trim();
    }

    const wanted = Math.max(0, Math.floor(input.maxItems ?? 0));
    const pageCap = Math.min(
      HARD_PAGE_CAP,
      Math.max(1, Math.floor(input.maxPages ?? HARD_PAGE_CAP)),
    );

    const rows: Record<string, unknown>[] = [];
    let cursor: string | undefined =
      typeof raw.cursor === "string" && raw.cursor ? raw.cursor : undefined;
    let pages = 0;
    let lastEnvelope: unknown = null;

    for (;;) {
      const result = await callApi(config, {
        platform: "meta",
        resource: "credits/transactions",
        params: cursor ? { ...ledgerParams, cursor } : ledgerParams,
      });
      if (!result.ok) {
        if (pages === 0) {
          await failGracefully(result.errorMessage ?? "Failed to fetch the credit ledger.");
        }
        log.warning(`Stopped paging the ledger: ${result.errorMessage}`);
        break;
      }
      pages += 1;
      lastEnvelope = result.json;
      const data = ((result.json as SocialCrawlSuccessResponse | null)?.data ??
        {}) as Record<string, unknown>;
      const items = Array.isArray(data.items) ? (data.items as Record<string, unknown>[]) : [];
      for (const item of items) rows.push({ kind: "credit_transaction", ...item });

      const next = typeof data.next_cursor === "string" ? data.next_cursor : null;
      // These pages are free, so the only reason to stop is the user's own cap.
      if (!next || items.length === 0 || wanted === 0) break;
      if (rows.length >= wanted || pages >= pageCap) break;
      cursor = next;
    }

    await Actor.pushData(rows);
    const net = rows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    await Actor.setValue("OUTPUT", {
      action,
      pages,
      count: rows.length,
      // Deductions are negative and refunds positive, so this sum agrees with
      // the balance delta across the rows fetched.
      net_credit_change: net,
      transactions: rows,
      last_envelope: lastEnvelope,
    });
    await Actor.setStatusMessage(
      `Fetched ${rows.length} credit-ledger row(s) across ${pages} page(s) — net ${net} credits. 0 credits charged.`,
    );
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
  if (platform === "cohorts") params = prepareCohortBody(params);

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
  const estimate = estimateRunCost(endpoint, plannedPages, params);

  // A join is opt-in and can multiply a page's price by its row count, so it is
  // never allowed to be a silent line on the invoice — and the endpoints that
  // offer one but were not asked are worth naming too, because the whole point
  // of the join is to save the caller N follow-up calls.
  const joinImpact = joinCostImpact(endpoint, params);
  if (joinImpact.note) {
    log.info(joinImpact.note);
  } else {
    const declared = endpoint.hydration ?? [];
    if (declared.length > 0) {
      const offered = declared.map((h) => h.token).join(",");
      const ceiling = declared.reduce((n, h) => n + tokenCeiling(h), 0);
      const fills = declared.flatMap((h) => h.fills).slice(0, 4).join(", ");
      log.info(
        `${publicPath(endpoint)} can fill more of every row in this same call: ` +
          `\`${declared[0]!.param}=${offered}\` adds ${fills}${declared.flatMap((h) => h.fills).length > 4 ? " and more" : ""}. ` +
          `It bills only for the rows it fills (up to ${ceiling} extra credits) and saves you one ` +
          `follow-up request per row. Run action "Row joins" for what each token adds.`,
      );
    }
  }

  // The cohort POST/PUT routes REJECT a call with no `Idempotency-Key`, and the
  // Apify form has no natural place to make a user invent a UUID. Generating
  // one per run keeps the route callable; supplying `idempotencyKey` yourself
  // is what makes a re-run replay the first result instead of creating a second
  // cohort or reserving a second query.
  const suppliedKey = input.idempotencyKey?.trim() || undefined;
  const idempotencyKey =
    suppliedKey ?? (endpoint.requiresIdempotencyKey ? randomUUID() : undefined);
  if (!suppliedKey && idempotencyKey) {
    log.info(
      `${publicPath(endpoint)} requires an Idempotency-Key; generated ${idempotencyKey} for this run. Pass it back as the \`idempotencyKey\` input to replay this exact call instead of creating another resource.`,
    );
  }

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
      // `pricing` prices the ENDPOINT (the whole band it can land in);
      // `cost_estimate` below prices THIS call. On a row-join endpoint those
      // are different numbers, and which one applies is decided here.
      row_join: (() => {
        const joins = includeJoins(endpoint);
        if (joins.length === 0) return null;
        const { min, max } = costRangeForCall(endpoint, params);
        return {
          requested: joinImpact.requested,
          tokens_sent: joinImpact.tokens,
          this_call_credits: min === max ? min : `${min}-${max}`,
          extra_credits_max: joinImpact.extraCreditsMax,
          note:
            joinImpact.note ??
            "No join requested, so this is priced as the plain call. Add an `include` token to the params to fill more of every row in the same request.",
          available: describeJoins(endpoint),
        };
      })(),
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
      ...(endpoint.requiresIdempotencyKey
        ? {
            idempotency: {
              required: true,
              key: idempotencyKey,
              supplied_by_user: Boolean(suppliedKey),
              note: suppliedKey
                ? "Your key. Replaying it with the same body returns the original resource."
                : "Generated for this run because the route requires the header. Set the `idempotencyKey` input to a fixed UUID to make re-runs replay instead of creating a second resource.",
            },
          }
        : {}),
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
    idempotencyKey,
    onPage: async (page) => {
      const rows = rowsFromEnvelope(
        endpoint.platform,
        endpoint.resource,
        page.envelope,
        page.result.raw,
        page.result.path,
        {
          endpoint,
          ...(maxItems > 0 ? { pageIndex: page.pageIndex } : {}),
        },
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
  const joins = describeJoins(e);
  return {
    platform: e.platform,
    resource: e.resource,
    method: e.method,
    public_path: publicPath(e),
    summary: e.summary,
    description: e.description,
    archetype: e.archetype,
    ...(e.tags?.length ? { tags: e.tags } : {}),
    ...(e.family ? { family: e.family } : {}),
    ...(e.group ? { group: e.group } : {}),
    ...(e.actionLabel ? { action_label: e.actionLabel } : {}),

    credit_tier: e.pricing.tier,
    credit_cost: e.pricing.cost,
    min_credits: min,
    max_credits: max,
    pricing_model: e.pricing.model,
    pricing_note: pricingNote(e),
    ...(e.pricing.description ? { pricing_description: e.pricing.description } : {}),
    cache_ttl_seconds: e.cache.ttlSeconds,
    cache_note: cacheNote(e),

    // The `include=…` joins: what more this one call can return, and what that
    // does to the price. `min_credits` above is the plain call; `max_credits`
    // is this join fully exercised.
    ...(joins ? { row_joins: joins } : {}),

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
    ...(e.requiresIdempotencyKey ? { requires_idempotency_key: true } : {}),
    ...(e.emptyOn404 ? { empty_result_is_not_an_error: true } : {}),
    ...(e.contractDetails?.length ? { contract_details: e.contractDetails } : {}),

    // Where the rows land in the envelope, and what each one is. This is what
    // makes the dataset predictable: `data.items[]` becomes one row per item,
    // `data.author` becomes a single row, and `_sc_item_kind` on every row
    // names the canonical object so mixed-endpoint datasets stay sortable.
    ...(e.responseShape
      ? {
          response_root: e.responseShape.root,
          ...(e.responseShape.itemKey
            ? { response_item_kind: e.responseShape.itemKey }
            : {}),
        }
      : {}),
    ...(e.responseFields ? { response_fields: e.responseFields } : {}),
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
