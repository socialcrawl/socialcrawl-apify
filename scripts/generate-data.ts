/**
 * Regenerate src/data/endpoints.ts, src/data/platforms.ts and
 * src/data/stats.ts from the backend registry dump.
 *
 * Pipeline:
 *   1. In the backend repo:  cd codebase/packages/social-api
 *      pnpm dlx tsx scripts/extract-mcp-data.ts --out <ABSOLUTE path>/socialcrawl-apify/registry-dump.json
 *      (`--out` resolves relative to the SCRIPT dir, so it must be absolute;
 *       the default target is the MCP repo, not this one.)
 *   2. Here:                 npm run generate:data
 *
 * Platform display names, endpoint counts, params + every param constraint,
 * the full pricing model, pagination descriptors, cache TTLs, archetypes and
 * doc strings all come straight from the dump (derived from the live registry —
 * the backend's single source of truth). Platform DESCRIPTIONS are maintained
 * in this script: it fails loudly when the dump contains a platform without
 * one, so a new platform can't ship undocumented.
 *
 * SOURCE OPACITY: the dump carries `upstream.kind` / `fallbackKinds` (internal
 * provider names). Those are deliberately NOT emitted into the Actor's data
 * files — no customer-facing surface may name an upstream vendor.
 *
 * The hand-written `src/data/monitors.ts` (the non-registry `/v1/monitors/*`
 * family) is NOT touched by this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface DumpParam {
  name: string;
  required: boolean;
  description: string;
  example: string;
}

interface DumpOptionalParam {
  name: string;
  type: string;
  enumValues?: string[];
  minimum?: number;
  maximum?: number;
  requires?: string;
  couplesWith?: { param: string; value: string };
  in?: "query" | "body";
  description?: string;
  example?: string;
}

interface DumpPricing {
  cost: number;
  tier: string;
  ladderCost: number;
  model: "ladder" | "flat" | "metered";
  minCost?: number;
  maxCost?: number;
  pageSize?: number;
  description?: string;
}

interface DumpPagination {
  style: string;
  nativeParam: string;
  limitParam?: string;
  limitMax?: number;
}

interface DumpEndpoint {
  platform: string;
  resource: string;
  method: string;
  params?: DumpParam[];
  optionalParams?: DumpOptionalParam[];
  oneOfGroups?: string[][];
  csvConstraints?: Record<string, { max?: number; enumValues?: string[] }>;
  creditTier: string;
  creditCost: number;
  pricing: DumpPricing;
  archetype: string;
  summary: string;
  description: string;
  execution?: string;
  streaming?: string;
  pagination?: DumpPagination;
  singlePage?: string;
  collectUntilN?: string;
  emptyOn404?: true;
  cache: { category: string; ttlSeconds: number };
  family?: string;
  group?: string;
  actionLabel?: string;
  contractDetails?: string[];
}

interface Dump {
  generatedFrom: string;
  schemaVersion?: number;
  stats: Record<string, number>;
  creditLadder: Record<string, number>;
  cacheTtls: Record<string, number>;
  platforms: {
    slug: string;
    name: string;
    endpointCount: number;
    social?: boolean;
    category?: string;
  }[];
  endpoints: DumpEndpoint[];
}

const PLATFORM_DESCRIPTIONS: Record<string, string> = {
  tiktok:
    "Profiles, videos, comments and replies, keyword/hashtag/top/user/sound search and autocomplete suggestions, trending feed, hashtag details, audience demographics, followers, following, liked videos, live streams, songs and song feeds, playlists, collections, effects and effect feeds, place-tagged videos, the TikTok Ad Library (ad search + ad details), video transcripts, on-screen text extraction, profile region lookup, and a one-call full profile dossier (profile + recent posts + computed analytics).",
  instagram:
    "Profiles, account transparency details, posts, reels, comments and comment replies, story highlights, stories and single-story download, tagged posts, location feeds, followers, following, similar accounts, post likers, post-reshare stats, one-call reels/posts lists with per-item share counts, account engagement analytics, unified/popular/reels/hashtag/profile/location/music search, username suggestions, trending reels and music, audio reels, embed HTML, and AI-powered media transcripts.",
  youtube:
    "Channels, channel contact email and country, videos, shorts, comments and replies, video sponsors, playlists and playlist items, community posts, keyword/hashtag/advanced search and autocomplete suggestions, trending videos and shorts, channel live streams, downloadable media files (audio, video, subtitles, thumbnails), batch video/channel/transcript lookups, and video transcripts.",
  twitter:
    "Profiles, tweets, tweet replies and retweeters, user media, followers, following, tweet and user search, communities, community tweets, video transcripts, AI-powered natural-language X search via Grok with citations, and a one-call full profile dossier.",
  linkedin:
    "Personal profiles and company pages, posts, a metered complete post-history archive, reposts, reactions, group and company posts, post comments and replies, people and company-people search, structured profile sub-resources (experiences, educations, skills, honors, certifications, publications, volunteers, recommendations, interests, images, videos, comments), jobs (job search, company jobs, job details), company insights and job counts, groups, location/school/industry search, public post search, post transcripts, and the LinkedIn Ad Library (ad details, ad search).",
  facebook:
    "Pages, groups and group posts, posts, comments and replies, photos, reels, one-call reels lists with exact views/likes/comments/shares merged in, events with event details and event search, Marketplace (keyword search, location search, item details), video and ad transcripts, the full Facebook Ad Library (ads, company ads, ad search, company search), and a one-call full profile dossier.",
  reddit:
    "Subreddit posts and details, user profiles with their post and comment history, single post lookup, post comments, post/comment/media keyword search, in-subreddit search, subreddit discovery by topic, post video transcripts, and a one-keyword omni-search across all of Reddit with subreddit attribution and top comments inline.",
  threads:
    "Profiles, posts, post details, post comments, keyword search, and user search.",
  pinterest:
    "Pins, boards, user boards, keyword search, and Pinterest Save-Button counts for any URL (url-stats).",
  twitch:
    "Streamer profiles, clip details, user videos, and broadcast schedules.",
  snapchat:
    "Public user profiles including subscriber count and bio, plus comments on a Spotlight clip.",
  truthsocial: "Profiles, user posts, and post details.",
  kick: "Clip details including view count, duration, and category.",
  kwai: "Profiles, user posts, and post details from Kwai (Kuaishou's international short-video app).",
  douyin:
    "China's Douyin (抖音) — creator profiles, their video feeds, single videos, video comments and comment replies, keyword video search, creator search, and the hot-search trending board. Most of the surface is metered per row returned, so quote the band from action \"List pricing\" before sizing a crawl.",
  telegram:
    "Public Telegram channels and groups — channel profiles with exact subscriber counts, paginated channel post feeds, and single posts by t.me URL, each with text, publish time, view count, the per-emoji reaction breakdown, and direct media URLs.",
  quora:
    "Question search, single questions with their answers, answer search, Space post search, profile search, Space search, and topic search across Quora.",
  apple_music:
    "Catalog search plus artists, albums, and tracks from Apple Music.",
  tiktokshop:
    "TikTok Shop product details, product reviews, shop product listings, shop search, and creator showcases.",
  perplexity:
    "Web research via Perplexity Sonar — returns a grounded answer with cited source URLs.",
  google:
    "Google web search, Google Ads Transparency Center (ad details, advertiser search, company ads), Google Business Profile (place info, extended cross-source reviews, owner updates, Q&A), and Google Travel hotels (search + rich hotel details).",
  google_news:
    "Real-time Google News SERP search — ranked headlines with source, snippet, and timestamp for any query.",
  finance:
    "Financial-instrument data — full quotes for stocks, ETFs, indices, forex and crypto, ticker search by name, a markets overview (regional indices plus the day's movers), instrument news, daily price history, company financial statements (income, balance sheet, cash flow), and options chains.",
  us_congress_trades:
    "US Congress stock-trade disclosures (STOCK Act filings) — searchable trades, 48-hour and 7-day recency feeds, the roster of disclosing members, per-politician and per-ticker trading summaries and trade lists, state-delegation trades, and a full stats suite: party comparison, sector and issuer breakdowns, most-active traders and tickers, volume over time, unusual activity, buy/sell ratio, and a late-filing (reporting-gap) ranking.",
  jobs:
    "Cross-board job data — job search and single-listing lookups on LinkedIn, Indeed, Bing and Xing, LinkedIn organization-id resolution, job-title suggestions, and salary ranges by title and country.",
  on_page:
    "On-page SEO audit for a single URL — the technical, content and metadata checks a crawler would run, in one call.",
  prism:
    'Cross-platform composite intelligence — server-side recipes that fan out across many platforms and fold the legs into one unified report. Universal URL lookup, full comment harvesting, brand-mention and consumer-demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar and post-mortems, cross-source reputation, share-of-voice, creator vetting, multi-engine AI consensus answers, and video/app/product intelligence. Each composite emits a per-leg transparency array; pricing is flat or metered per recipe — run action "List pricing" for the exact band.',
  amazon:
    "Product search, full ASIN product details, on-page reviews, buy-box sellers and offers, seller profiles, Best Sellers by category, current deals, and Amazon shop/storefront pages — across ~13 Amazon marketplaces via the country parameter.",
  google_shopping:
    "Google Shopping product search, full product details, reviews aggregated across retailers, per-seller offers with itemised pricing, and product price history.",
  walmart:
    "Walmart product details, product reviews, keyword search, category browse, and every seller offering a given product.",
  target:
    "Target product details by TCIN, product reviews, category browse, the full category taxonomy, and store lookup near a location.",
  home_depot:
    "Home Depot keyword product search, product details by item id or URL, product reviews, and store lookup near a ZIP code.",
  ebay: "eBay listing search and full listing details by item id.",
  etsy: "Etsy listings by id or URL, shop product listings, similar-listing recommendations, and search suggestions.",
  wayfair:
    "Wayfair keyword product search, product details by SKU, and product reviews.",
  sephora:
    "Sephora product details, reviews, keyword search and search suggestions, category browse with the category tree, brand listings and per-brand products, store lookup near a coordinate, and in-store SKU availability.",
  aliexpress:
    "AliExpress product details, keyword search, similar products, reviews, per-SKU shipping options and costs, hot-product and promotion feeds, the category tree, and the list of featured promotions.",
  hm: "H&M keyword product search and search suggestions, the category tree, per-country store lists, the countries/languages reference, and the supplier-and-factory disclosure behind a product.",
  kohls:
    "Kohl's keyword product search, product reviews, customer questions and answers, store lookup near a coordinate, and the category tree.",
  klarna:
    "Klarna's shopping comparison surface — product details, merchant offers for a product, keyword search and suggestions, user and professional reviews plus review-score overviews, price history, side-by-side product comparison, category browse with the full category tree, per-category filters, popular keywords and buying guides, and store listings with their products and filters.",
  gumtree:
    "Gumtree UK classifieds — keyword listing search, single ads by id or URL, similar listings, seller profiles and their active ads, search suggestions, trending searches, the category tree, per-category filters, and location autocomplete and nearest-location lookup.",
  yelp: "Yelp business lookup by encid, business reviews, business search in both compact and full-card form, and search suggestions.",
  g2: "G2 software reviews — product pages by slug or URL, product reviews, category product listings and the full category index, vendor (seller) profiles and their product catalogues, and a product-URL index for bulk discovery.",
  trustpilot:
    "Trustpilot business search and company reviews — brand-reputation data keyed by company domain (shipping, refunds, support sentiment). For product reviews use amazon/reviews or google_shopping/reviews.",
  google_play:
    "Google Play app search, full app details, app reviews with developer replies, store charts (top free/paid/grossing), a filterable app listings database, and categories/locations/languages reference data.",
  app_store:
    "Apple App Store app search, full app details, app reviews, store charts (top free/paid/grossing for iPhone and iPad), a filterable app listings database, and categories/locations/languages reference data.",
  tripadvisor:
    "The full Tripadvisor travel surface — cross-type place and business search with autocomplete, single places by URL, and dedicated hotel, restaurant, attraction and cruise search plus per-entity detail pages and their traveler reviews (with owner replies, review images, and cross-language auto-translation metadata), plus the experience types available in a destination.",
  utility:
    "The API's own developer-experience surface, and the best place to start — all free (0 credits). `quickstart` returns auth, the response envelope, the credit model, the full error taxonomy, rate limits and a working first call in one response. `endpoints` is the machine-readable catalog of everything callable. `endpoint` is the complete usage guide for any single endpoint, with a copy-paste curl and an example response. `llms` is the AI-agent context corpus, so an agent can bootstrap itself in one call instead of scraping docs. All four are generated from the live registry at request time, so they never drift from what is actually callable.",
  linktree:
    "Linktree link-in-bio pages including display name, bio, avatar, and link list.",
  linkbio:
    "Linkbio link-in-bio pages including display name, bio, avatar, and link list.",
  linkme:
    "Linkme link-in-bio pages including display name, bio, avatar, and link list.",
  komi: "Komi link-in-bio pages including display name, bio, avatar, and link list.",
  pillar:
    "Pillar link-in-bio pages including display name, bio, avatar, and link list.",
  polymarket:
    "Prediction-market research — a server-side fan-out that expands a topic across multiple queries and ranks the merged Polymarket events.",
  hackernews:
    "Story search, story details, story comment trees, and user profiles.",
  github:
    "Users, repositories, user repos, READMEs, releases, issues, pull requests, issue/PR comments, issue/PR search, and composite repo top-issues/dossier + user profile-velocity reports.",
  tavily:
    "Web search with optional LLM-synthesised answer, content extraction from URLs, lightweight sitemap discovery, and full multi-page crawl.",
  naver:
    "Korea's #1 search portal — 8 search corpora (blog, news, encyclopedia, cafe article, Q&A (KiN), local places, image, and web search), Korean query errata correction and adult-term detection, Data Lab search-volume trends and Shopping click-insight by category and keyword, plus a cross-corpus brief that fans one query across the main corpora with an optional digest.",
  rumble:
    "Video search, channel videos, video details, video comments, and video transcripts.",
  bluesky:
    "Profiles, user posts, and post details from the AT Protocol social network.",
  spotify:
    "Artists, tracks, albums, podcasts, podcast episodes, and search across the Spotify catalog.",
  search:
    "Meta-search across 14 platforms in a single call (up to 17 sources in hashtag mode) — LLM-planned, RRF-fused, LLM-reranked and clustered — plus a fused forum search across Reddit, Hacker News and Korean forums with top comments inline, creator discovery fused across TikTok, Threads and Instagram, and a multi-country news search that localizes one query across two independent news indexes.",
  content_analysis:
    "Cross-web brand-mention search and 6-axis sentiment intelligence over news, blogs, ecommerce, and message boards — paginated mention feeds, sentiment/summary aggregates, rating distributions, phrase and category trends, plus languages/locations/categories/filters reference data.",
  web: "Web scraping and research — scrape any URL to clean markdown/HTML, web search with optional page content, site mapping, LLM-powered structured extraction, async crawl and batch-scrape jobs, an autonomous web agent, scheduled page monitors with change detection, interactive browser sessions with remote code execution, and document parsing. The stateful routes (jobs, monitors, sessions) span GET/POST/PATCH/DELETE and use `{id}` path templates — set the `method` input to pick a verb and supply the id as a normal parameter.",
  google_trends:
    "Google Trends interest data — explore interest-over-time and regional interest for one or more keywords, and surface rising related queries for a seed keyword, with optional location, timeframe, and category filters.",
};

const root = resolve(import.meta.dirname, "..");
const dump: Dump = JSON.parse(
  readFileSync(resolve(root, "registry-dump.json"), "utf8"),
);

// ── Guard: the dump must be the v2 schema this generator understands ────
if ((dump.schemaVersion ?? 1) < 2) {
  console.error(
    `registry-dump.json is schema v${dump.schemaVersion ?? 1}; this generator needs v2 (pricing, param bounds, pagination, cache). Re-run the backend extractor with --out pointing at this repo.`,
  );
  process.exit(1);
}

// ── Guard: every platform must have a description ──────────────────────
const missing = dump.platforms.filter((p) => !PLATFORM_DESCRIPTIONS[p.slug]);
if (missing.length > 0) {
  console.error(
    `Missing PLATFORM_DESCRIPTIONS entries for: ${missing.map((p) => p.slug).join(", ")}`,
  );
  process.exit(1);
}
const stale = Object.keys(PLATFORM_DESCRIPTIONS).filter(
  (slug) => !dump.platforms.some((p) => p.slug === slug),
);
if (stale.length > 0) {
  console.warn(
    `note: PLATFORM_DESCRIPTIONS has entries for platforms no longer in the registry: ${stale.join(", ")}`,
  );
}

const str = (s: string): string => JSON.stringify(s);

// ── platforms.ts ────────────────────────────────────────────────────────
const platformBlocks = dump.platforms
  .map((p) => {
    const lines = [
      "  {",
      `    slug: ${str(p.slug)},`,
      `    name: ${str(p.name)},`,
      `    endpointCount: ${p.endpointCount},`,
      `    social: ${p.social ?? true},`,
    ];
    if (p.category) lines.push(`    category: ${str(p.category)},`);
    lines.push(`    description:`);
    lines.push(`      ${str(PLATFORM_DESCRIPTIONS[p.slug])},`);
    lines.push("  },");
    return lines.join("\n");
  })
  .join("\n");

const platformsTs = `import type { Platform } from "../types.js";

/**
 * All SocialCrawl platforms with ACTIVE registry endpoints, derived from the
 * backend registry. Generated by scripts/generate-data.ts — do not hand-edit.
 * Descriptions are maintained in that script.
 *
 * The non-registry \`monitors\` family lives in ./monitors.ts and is merged in
 * by ../catalog.ts.
 * Source: ${dump.generatedFrom}
 */
export const PLATFORMS: Platform[] = [
${platformBlocks}
];
`;

// ── endpoints.ts ────────────────────────────────────────────────────────
function renderParam(p: DumpParam): string {
  return `      { name: ${str(p.name)}, required: true, description: ${str(p.description)}, example: ${str(p.example)} },`;
}

function renderOptionalParam(p: DumpOptionalParam): string {
  const parts = [`name: ${str(p.name)}`, `type: ${str(p.type)}`];
  if (p.enumValues) {
    parts.push(`enumValues: [${p.enumValues.map(str).join(", ")}]`);
  }
  if (p.minimum !== undefined) parts.push(`minimum: ${p.minimum}`);
  if (p.maximum !== undefined) parts.push(`maximum: ${p.maximum}`);
  if (p.requires) parts.push(`requires: ${str(p.requires)}`);
  if (p.couplesWith) {
    parts.push(
      `couplesWith: { param: ${str(p.couplesWith.param)}, value: ${str(p.couplesWith.value)} }`,
    );
  }
  if (p.in) parts.push(`in: ${str(p.in)}`);
  if (p.description) parts.push(`description: ${str(p.description)}`);
  if (p.example) parts.push(`example: ${str(p.example)}`);
  return `      { ${parts.join(", ")} },`;
}

function renderPricing(p: DumpPricing): string {
  const parts = [
    `cost: ${p.cost}`,
    `tier: ${str(p.tier)}`,
    `ladderCost: ${p.ladderCost}`,
    `model: ${str(p.model)}`,
  ];
  if (p.minCost !== undefined) parts.push(`minCost: ${p.minCost}`);
  if (p.maxCost !== undefined) parts.push(`maxCost: ${p.maxCost}`);
  if (p.pageSize !== undefined) parts.push(`pageSize: ${p.pageSize}`);
  if (p.description) parts.push(`description: ${str(p.description)}`);
  return `{ ${parts.join(", ")} }`;
}

function renderPagination(p: DumpPagination): string {
  const parts = [`style: ${str(p.style)}`, `nativeParam: ${str(p.nativeParam)}`];
  if (p.limitParam) parts.push(`limitParam: ${str(p.limitParam)}`);
  if (p.limitMax !== undefined) parts.push(`limitMax: ${p.limitMax}`);
  return `{ ${parts.join(", ")} }`;
}

function renderCsvConstraints(
  c: Record<string, { max?: number; enumValues?: string[] }>,
): string {
  const entries = Object.entries(c).map(([name, spec]) => {
    const parts: string[] = [];
    if (spec.max !== undefined) parts.push(`max: ${spec.max}`);
    if (spec.enumValues) {
      parts.push(`enumValues: [${spec.enumValues.map(str).join(", ")}]`);
    }
    return `${str(name)}: { ${parts.join(", ")} }`;
  });
  return `{ ${entries.join(", ")} }`;
}

function renderEndpoint(e: DumpEndpoint): string {
  const params = e.params ?? [];
  const optionalParams = e.optionalParams ?? [];
  const oneOfGroups = e.oneOfGroups ?? [];

  const lines: string[] = ["  {"];
  lines.push(`    platform: ${str(e.platform)},`);
  lines.push(`    resource: ${str(e.resource)},`);
  lines.push(`    method: ${str(e.method)},`);
  if (params.length > 0) {
    lines.push("    params: [");
    for (const p of params) lines.push(renderParam(p));
    lines.push("    ],");
  } else {
    lines.push("    params: [],");
  }
  if (optionalParams.length > 0) {
    lines.push("    optionalParams: [");
    for (const p of optionalParams) lines.push(renderOptionalParam(p));
    lines.push("    ],");
  } else {
    lines.push("    optionalParams: [],");
  }
  const groups = oneOfGroups.map((g) => `[${g.map(str).join(", ")}]`).join(", ");
  lines.push(`    oneOfGroups: [${groups}],`);
  if (e.csvConstraints) {
    lines.push(`    csvConstraints: ${renderCsvConstraints(e.csvConstraints)},`);
  }
  lines.push(`    creditTier: ${str(e.creditTier)},`);
  lines.push(`    creditCost: ${e.creditCost},`);
  lines.push(`    pricing: ${renderPricing(e.pricing)},`);
  lines.push(`    archetype: ${str(e.archetype)},`);
  lines.push(`    summary: ${str(e.summary)},`);
  lines.push("    description:");
  lines.push(`      ${str(e.description)},`);
  if (e.execution) lines.push(`    execution: ${str(e.execution)},`);
  if (e.streaming) lines.push(`    streaming: ${str(e.streaming)},`);
  if (e.pagination) {
    lines.push(`    pagination: ${renderPagination(e.pagination)},`);
  }
  if (e.singlePage) lines.push(`    singlePage: ${str(e.singlePage)},`);
  if (e.collectUntilN) lines.push(`    collectUntilN: ${str(e.collectUntilN)},`);
  if (e.emptyOn404) lines.push(`    emptyOn404: true,`);
  lines.push(
    `    cache: { category: ${str(e.cache.category)}, ttlSeconds: ${e.cache.ttlSeconds} },`,
  );
  if (e.family) lines.push(`    family: ${str(e.family)},`);
  if (e.group) lines.push(`    group: ${str(e.group)},`);
  if (e.actionLabel) lines.push(`    actionLabel: ${str(e.actionLabel)},`);
  if (e.contractDetails?.length) {
    lines.push(
      `    contractDetails: [${e.contractDetails.map(str).join(", ")}],`,
    );
  }
  lines.push("  },");
  return lines.join("\n");
}

const endpointSections: string[] = [];
for (const platform of dump.platforms) {
  const eps = dump.endpoints.filter((e) => e.platform === platform.slug);
  endpointSections.push(
    `  // --- ${platform.slug} (${eps.length} endpoint${eps.length === 1 ? "" : "s"}) ---`,
  );
  for (const e of eps) endpointSections.push(renderEndpoint(e));
}

const endpointsTs = `import type { Endpoint } from "../types.js";

/**
 * All ACTIVE SocialCrawl registry endpoints, derived from the backend
 * registry. Source: ${dump.generatedFrom}
 * Generated by scripts/generate-data.ts from registry-dump.json — see that
 * script's header for the full regeneration pipeline. Do not hand-edit.
 *
 * The non-registry \`monitors\` family lives in ./monitors.ts and is merged in
 * by ../catalog.ts.
 */
export const ENDPOINTS: Endpoint[] = [
${endpointSections.join("\n")}
];
`;

// ── stats.ts ────────────────────────────────────────────────────────────
const meteredCount = dump.endpoints.filter(
  (e) => e.pricing.model === "metered",
).length;
const flatCount = dump.endpoints.filter(
  (e) => e.pricing.model === "flat",
).length;
const ladderCount = dump.endpoints.filter(
  (e) => e.pricing.model === "ladder",
).length;
const freeCount = dump.endpoints.filter((e) => e.pricing.cost === 0).length;
const paginatableCount = dump.endpoints.filter((e) => e.pagination).length;

const statsTs = `/**
 * Registry counts baked in at generation time. Generated by
 * scripts/generate-data.ts — do not hand-edit. Counts cover the REGISTRY
 * surface only; the non-registry \`monitors\` family is excluded, matching the
 * backend's own REGISTRY_STATS.
 *
 * These are the single source of truth for every count in the Actor's copy
 * (README, .actor/input_schema.json, .actor/actor.json). src/data.test.ts
 * fails when the generated data files drift from them.
 */
export const REGISTRY_STATS = {
  totalPlatforms: ${dump.platforms.length},
  totalEndpoints: ${dump.endpoints.length},
  socialPlatforms: ${dump.stats.socialPlatforms ?? 0},
  universalSearchPlatforms: ${dump.stats.universalSearchPlatforms ?? 0},
  universalSearchSources: ${dump.stats.universalSearchSources ?? 0},
  /** Endpoints charging the plain 1/5/10 tier rate. */
  ladderPriced: ${ladderCount},
  /** Endpoints with a flat per-endpoint override off the ladder. */
  flatPriced: ${flatCount},
  /** Endpoints whose charge is computed per request from the params sent. */
  meteredPriced: ${meteredCount},
  /** Endpoints that never charge a credit. */
  freeEndpoints: ${freeCount},
  /** Endpoints that accept the universal \`cursor\` and can be auto-paginated. */
  paginatableEndpoints: ${paginatableCount},
} as const;

/** The 1/5/10 credit ladder, straight from the backend constants. */
export const CREDIT_LADDER = ${JSON.stringify(dump.creditLadder)} as const;

/** Cache TTL seconds per category. A hit inside the window costs 0 credits. */
export const CACHE_TTLS = ${JSON.stringify(dump.cacheTtls)} as const;
`;

writeFileSync(resolve(root, "src/data/platforms.ts"), platformsTs);
writeFileSync(resolve(root, "src/data/endpoints.ts"), endpointsTs);
writeFileSync(resolve(root, "src/data/stats.ts"), statsTs);

console.log(
  `wrote src/data/platforms.ts (${dump.platforms.length} platforms), src/data/endpoints.ts (${dump.endpoints.length} endpoints), src/data/stats.ts`,
);
console.log(
  `  pricing: ${ladderCount} ladder · ${flatCount} flat · ${meteredCount} metered · ${freeCount} free`,
);
console.log(`  pagination: ${paginatableCount} endpoints accept a cursor`);
