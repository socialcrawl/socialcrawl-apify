<img src="https://www.socialcrawl.dev/images/sc-logo-text.png" alt="SocialCrawl" height="56" />

# SocialCrawl — Unified Social Media Data API

**One API key for every social platform.** Scrape and search **65 platforms across 575 endpoints** — TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Threads, Douyin, Telegram, Quora, Amazon, Klarna, AliExpress, Walmart, Target, Sephora, Gumtree, Yelp, Tripadvisor, G2, Google, the App Stores and many more — through a single, consistent response envelope. Plus a **universal cross-platform social search** that fans out across 14 networks in one call, **Prism composites** that fold many platforms into one unified report, a full **web-scraping suite** (scrape, crawl, extract, search, monitor), **scheduled monitors** that re-run any endpoint on a cadence and post each result to your webhook, and **cohort queries** that ask which of a panel *you* upload posted about your keywords.

This Actor is a thin, reliable wrapper around the [SocialCrawl API](https://www.socialcrawl.dev). You bring your own SocialCrawl API key (100 free credits on signup, no credit card), pick a platform and endpoint, and get back clean, normalized JSON — straight into an Apify dataset you can export to CSV, JSON, Excel, or pipe into your own pipelines, integrations, and AI agents.

> **Why it exists:** most social data tools force you to wire up a different scraper, auth flow, and JSON shape for every platform. SocialCrawl replaces a dozen fragmented integrations with **one key, one envelope, one credit system.** This Actor brings that unified surface to the Apify platform — with Apify's scheduling, storage, webhooks, and integrations on top.

---

## What you can do

- **Learn the API for free** — 0-credit actions that answer from the live API, not from a snapshot: **Quickstart** (auth, envelope, credit model, every error code, rate limits, a working first call), **Endpoint guide** (one endpoint's full instructions, with a copy-paste curl and an example response), **Agent context** (the `llms.txt` corpus, saved as a `.md` file your AI agent can ingest), **Check for updates** (does this Actor's bundled catalog still match the API?), and **Credit ledger** (every deduction and refund, keyed by `request_id`). See [Learning the API](#learning-the-api-free) below.
- **Profiles & posts** — fetch a creator's profile, post/video list, followers, and engagement stats from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Threads, Pinterest, Twitch, Bluesky, and more.
- **Comments & replies** — pull comment trees for a post, video, or thread.
- **Search** — keyword, hashtag, and user search per platform.
- **Universal social search** — one query fanned out across 14 social platforms (up to 17 sources in hashtag mode), LLM-planned, fused, reranked, and clustered (`platform = Universal Search`, `resource = everywhere`), plus a fused forum search (`resource = forums`), fused creator discovery across TikTok/Threads/Instagram (`resource = creators`), and a multi-country news search (`resource = news`).
- **Prism composites** — server-side recipes that fan out across many platforms and fold the legs into one unified report: universal URL lookup, brand-mention and demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar, creator vetting, reputation, and video/app/product intelligence (`platform = Prism`).
- **Commerce & reviews** — Amazon, Walmart, Target, Home Depot, Wayfair, eBay, Etsy, Sephora, AliExpress, H&M, Kohl's, Klarna, Gumtree, Google Shopping, Yelp, Trustpilot, G2 and Tripadvisor product/business data, price history, seller profiles, category trees and reviews.
- **App stores** — Google Play and Apple App Store app details, reviews, and charts.
- **Web research** — Perplexity and Tavily grounded answers; Google News & Google Trends; Naver (Korea's #1 portal, including Data Lab trends and Shopping insight); Hacker News; GitHub; prediction markets; on-page SEO audits; cross-web brand-mention sentiment.
- **Finance & public records** — quotes, markets overviews, instrument news, daily price history, company financial statements and options chains (`platform = Finance`); the full US Congress stock-trade disclosure dataset with per-politician, per-ticker, sector and late-filing analytics (`platform = US Congress Trades`).
- **Jobs & salaries** — job search and single-listing lookups across LinkedIn, Indeed, Bing and Xing, plus salary ranges by title and country (`platform = Jobs`).
- **Web scraping** — scrape any URL to clean markdown/HTML, LLM-powered structured extraction, site mapping, async crawl & batch-scrape jobs, an autonomous web agent, page monitors with change detection, interactive browser sessions with remote code execution, and document parsing (`platform = Web Scraping`).
- **Scheduled monitors** — re-run any endpoint or Prism composite hourly, daily, weekly or on a cron; each run is delivered to an HMAC-signed webhook, checked against alert rules, and appended to a queryable time-series (`platform = Monitors`).
- **Cohort queries** — upload a panel you already have (up to 10,000 public identities across 10 platforms) and ask which of *those specific accounts* posted your keywords in a recent window. Every match carries your own `external_id`, and every member gets a coverage row — including the ones that matched nothing (`platform = Cohorts`). See [Cohorts](#cohorts--audience-filtered-mention-search).
- **Row joins (`include=…`)** — on 28 endpoints, one call also fills a second source onto every row it returns: save counts on a Pinterest search, exact follower counts on a LinkedIn people search, subscriber counts on a YouTube list, the engagement block on rows that ship without one. It replaces one follow-up request per row and bills only for the rows it actually filled. See [Row joins](#row-joins-include--one-call-instead-of-n1).
- **Transcripts** — AI-powered video/audio transcripts for TikTok, Instagram, YouTube, and more.

See the full, always-current endpoint list by running the Actor with **action = "List endpoints"**, or find one by keyword with **action = "Search endpoints"** — neither needs an API key.

---

## Quick start

1. **Try it with no setup.** Just click **Start** — with no API key, the Actor returns the full catalog of supported platforms so you can see what's available.
2. **Get a free API key.** Sign up at **[socialcrawl.dev](https://www.socialcrawl.dev)** — you get 100 free credits, no credit card.
3. **Paste the key** into the `apiKey` field, keep the pre-filled TikTok `@charlidamelio` example (or change it), and hit **Start**.
4. **Read your results** in the **Dataset** tab, or export them to CSV / JSON / Excel.
5. **Learn the rest for free.** Run the Actor again with `action = "Quickstart"` — 0 credits, and it returns everything you need to use the API correctly: the auth header, the response envelope, the credit model, the complete error taxonomy, rate limits, and the pagination rule.

That first run returns something like:

```json
{
  "author": { "handle": "charlidamelio", "followers": 155000000, "verified": true, "...": "..." },
  "computed": { "engagement_rate": 0.041, "...": "..." },
  "_sc_platform": "tiktok",
  "_sc_endpoint": "/v1/tiktok/profile",
  "_sc_credits_used": 1,
  "_sc_credits_remaining": 9999
}
```

---

## Input

| Field | Description |
|-------|-------------|
| **`apiKey`** | Your SocialCrawl API key (`sc_…`). Required for data requests. Get one free at [socialcrawl.dev](https://www.socialcrawl.dev). |
| **`action`** | `Run API request` (default); the free learning actions `Quickstart`, `Endpoint guide`, `Agent context`, `Check for updates`; the free browsing actions `List platforms`, `List endpoints`, `Search endpoints`, `List pricing`, `Row joins`; `Check credit balance`; or `Credit ledger` (every deduction and refund, with receipts). Everything except `Run API request` costs **0 credits**. |
| **`platform`** | The platform to query, e.g. `tiktok`, `instagram`, `amazon`, `web`. Choose **Universal Search** to query many platforms at once, **Monitors** to schedule a recurring run, or **Cohorts** to search a panel you upload. |
| **`resource`** | The endpoint on that platform, e.g. `profile`, `profile/videos`, `video/comments`. For Universal Search use `everywhere`. Path-template resources (e.g. `web/jobs/{job_id}`, or the Cohorts routes) take their id as a normal parameter. |
| **`params`** | Parameters as JSON, e.g. `{ "handle": "charlidamelio" }` or `{ "query": "electric cars" }`. Add `{ "include": "engagement" }` on a [row-join](#row-joins-include--one-call-instead-of-n1) endpoint to fill a second source onto every row of the same call. For `GET`/`DELETE` these become the query string; for `POST`/`PUT`/`PATCH` (web crawl, agent, monitors, cohorts…) they're sent as a typed JSON body, so arrays and objects keep their JSON types. |
| **`allPlatforms`** | For `List endpoints` / `List pricing` / `Row joins`: ignore the Platform dropdown (which can never be empty) and return the whole catalog in one run. |
| **`query`** | Keyword(s) for `action = "Search endpoints"` — e.g. `comments`, `product reviews`, `transcript`. |
| **`format`** | For `action = "Agent context"`: `markdown` (the llms.txt corpus, also saved as a `.md` file) or `json` (the same content, structured). |
| **`maxItems`** | *(Pagination)* `0` = a single request. Higher, and the Actor follows the API's `next_cursor` until it has this many items. **Each page is a separate billed call** — except on the free routes (cohort results, the credit ledger). |
| **`maxPages`** | *(Pagination)* Hard ceiling on billed page requests, whatever `maxItems` says. Default 20, max 500. |
| **`dryRun`** | *(Advanced)* Validate and price the request without calling the API or spending a credit. It prices **this call**, not the endpoint — so a [row-join](#row-joins-include--one-call-instead-of-n1) endpoint is quoted at its plain rate unless your `params` actually ask for the join. |
| **`method`** | *(Optional)* Leave blank — resolves automatically. Only set it for the stateful routes that share one resource across several verbs (e.g. `web/monitors/{monitor_id}` is `GET`, `PATCH`, or `DELETE`). |
| **`idempotencyKey`** | *(Optional, advanced)* A UUIDv4 that makes retries safe — replays within 24h charge 0 new credits. The cohort `create` / `members` / `query` routes **require** this header: leave it blank and the Actor generates one per run (so a re-run creates another resource), or pin it to make re-runs replay. |
| **`baseUrl`** | *(Optional, advanced)* Override the API origin. Defaults to `https://www.socialcrawl.dev`. |

**Not sure what to put in `resource` / `params`?** Run `action = "Search endpoints"` with a keyword, or `action = "List endpoints"` with a platform. Both return every endpoint with its public path, HTTP method, credit band + pricing note, cache window, whether it can be auto-paginated, and **every parameter** with its type, allowed values, numeric bounds, coupling rules, description and example. For a pure pricing catalog across all 575 endpoints, use `action = "List pricing"` with `allPlatforms` ticked.

## Learning the API (free)

SocialCrawl documents itself *through the API*. Four endpoints on the `utility`
platform are generated from the live registry at request time, so they can never
drift from what is actually callable — and all four cost **0 credits**. This
Actor exposes each as a first-class action, alongside the account's own credit
ledger.

| Action | Answers | Saved to |
|--------|---------|----------|
| **Quickstart** | How do I configure and call this API? Auth header, base URL, the response envelope, the credit model, the **complete error taxonomy** (one dataset row per code, with its HTTP status and what it means), rate limits, the pagination rule, and a working first request. | Dataset + `OUTPUT` |
| **Endpoint guide** | How exactly do I call *this* endpoint? Every parameter with type, description and example; the exact credit cost and billing rules; the cache window; the pagination recipe; a **copy-paste curl**; an example response; the response schema URL; and related endpoints. | Dataset + `OUTPUT` + `REQUEST_CURL` |
| **Agent context** | Give my AI agent everything it needs in one call — the same corpus as `llms.txt`, for the whole API or one platform. | Dataset + `OUTPUT` + **`AGENT_CONTEXT.md`** (a real markdown file) |
| **Check for updates** | Is this Actor's bundled catalog still current? Diffs the live catalog against the snapshot the Actor validates against and reports every difference: new endpoints, withdrawn ones, price changes, parameter changes, pagination changes. | Dataset + `OUTPUT` |
| **Credit ledger** | What was I actually charged, and for which request? Every deduction and refund as its own dataset row — amount (deductions negative, refunds positive), `balance_after`, endpoint, tier and `request_id` — keyset-paginated newest first. Pass `{"request_id": "req-…"}` in `params` for one request's receipt, or set `maxItems` to walk the ledger. | Dataset + `OUTPUT` |

These need your API key (every SocialCrawl route is authenticated) but never
charge a credit. The five **Browse** actions need no key at all — they answer
from the catalog bundled into this Actor.

**Why "Check for updates" matters.** This Actor validates your request locally
before spending anything, using a catalog captured when the Actor was released.
That is what makes a typo free instead of a 400 you paid for — but a snapshot
cannot tell you it has gone stale. The live API is always authoritative; this
action is how you find out where the two disagree.

```json
{ "action": "quickstart", "apiKey": "sc_...", "allPlatforms": true }
```
```json
{ "action": "endpointGuide", "apiKey": "sc_...", "platform": "instagram", "resource": "profile/reels" }
```
```json
{ "action": "agentContext", "apiKey": "sc_...", "platform": "tiktok", "format": "markdown" }
```
```json
{ "action": "checkForUpdates", "apiKey": "sc_..." }
```
```json
{ "action": "listRowJoins", "allPlatforms": true }
```

---

### Example inputs

**TikTok profile:**
```json
{ "platform": "tiktok", "resource": "profile", "params": { "handle": "charlidamelio" } }
```

**YouTube video comments, auto-paginated to 500 items:**
```json
{ "platform": "youtube", "resource": "video/comments", "params": { "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }, "maxItems": 500, "maxPages": 25 }
```

**Walmart product reviews:**
```json
{ "platform": "walmart", "resource": "reviews", "params": { "product_id": "17835006350" } }
```

**Universal social search (one query, many platforms):**
```json
{ "platform": "search", "resource": "everywhere", "params": { "query": "best running shoes 2026" } }
```

**Scrape a web page to clean markdown:**
```json
{ "platform": "web", "resource": "scrape", "params": { "url": "https://example.com", "formats": "markdown" } }
```

**Price a metered call before running it:**
```json
{ "platform": "prism", "resource": "comments", "params": { "url": "https://www.tiktok.com/@x/video/123" }, "dryRun": true }
```

**Schedule a daily brand-mention monitor:**
```json
{
  "platform": "monitors",
  "resource": "create",
  "params": {
    "recipe": "prism/brand-mentions",
    "params": { "brand": "acme" },
    "cadence": "daily",
    "webhook_url": "https://example.com/hooks/socialcrawl",
    "alert_rules": [{ "metric": "total_mentions", "op": "pct_change_gt", "value": 25 }]
  }
}
```

**Congressional trades for one ticker:**
```json
{ "platform": "us_congress_trades", "resource": "ticker/trades", "params": { "ticker": "NVDA" } }
```

**A financial instrument's quote and its options chain:**
```json
{ "platform": "finance", "resource": "quote", "params": { "keyword": "GOOGL:NASDAQ" } }
```

**Klarna price history for a product:**
```json
{ "platform": "klarna", "resource": "product/price-history", "params": { "product_id": "..." } }
```

**Search LinkedIn jobs:**
```json
{ "platform": "jobs", "resource": "linkedin/search", "params": { "keyword": "data engineer", "location": "London" } }
```

**Pull the receipt for one billed request:**
```json
{ "action": "creditTransactions", "apiKey": "sc_...", "params": { "request_id": "req-a1b2c3d4e5f6" } }
```

---

## Output

Each result item is pushed to the Actor's **dataset**:

- **List responses** (posts, comments, search results…) become **one row per item**.
- **Single-object responses** (a profile, an app, a product…) become **one row**.
- Rows are read from the exact path the registry declares for that endpoint (`data.items[]`, `data.author`, `data.post`, `data.page`…) rather than guessed at, so the dataset shape is predictable across all 421 endpoints that declare one. `_sc_item_kind` names the canonical object each row is (`post`, `author`, `product`, `web_page`…), which keeps a mixed-endpoint dataset sortable.
- Every row carries credit/request metadata under `_sc_`-prefixed fields (`_sc_platform`, `_sc_endpoint`, `_sc_credits_used`, `_sc_credits_remaining`, `_sc_request_id`, `_sc_cached`, `_sc_item_kind`, and `_sc_page` when auto-paginating) so it never collides with platform data fields.
- On a [row-joined](#row-joins-include--one-call-instead-of-n1) call, the API's `data.hydration` receipt is lifted onto every row as `_sc_hydration_*` — the rows attempted, the credits held and kept, and the time the join added.

The **complete, untouched API envelope** is also saved to the run's **key-value store** as `OUTPUT` — useful when you want the raw nested response plus exact credit accounting. An auto-paginated run stores every page's envelope plus a `stop_reason` and the `next_cursor` you'd resume from.

Export the dataset to **JSON, CSV, Excel, XML, or RSS**, or fetch it via the Apify API.

---

## Pricing & credits

This Actor is **free on Apify** — you only pay Apify's standard platform usage (compute is tiny; most calls finish in seconds on the minimum memory setting).

The **data itself is billed by SocialCrawl** against your own API key. Endpoints price in one of three shapes, and the difference matters when you're sizing a run:

**1. The tier ladder — 443 endpoints.** A fixed price per call.

| Tier | Credits | Endpoints | Examples |
|------|--------:|----------:|----------|
| Standard | **1** | 258 | Most profile/post/comment/search endpoints; category trees and reference data; web scrape/map/batch-scrape/parse |
| Advanced | **5** | 166 | Analytics-heavy endpoints, ad libraries, commerce catalogues (Klarna, AliExpress, Sephora, Gumtree, G2, Wayfair…), structured web extraction |
| Premium | **10** | 19 | Video/audio transcripts (except YouTube), job search, and the heaviest single-call endpoints |

**2. Flat overrides — 61 endpoints.** A per-endpoint price off the ladder:

| Endpoint(s) | Credits |
|-------------|--------:|
| Utility discovery + the stateful web job/monitor/session control routes, and `prism/lookup` (18 of them) | **0** |
| `web/map`, `web/batch-scrape`, `web/parse` | **1** |
| YouTube video transcript (`youtube/video/transcript`) | **3** |
| One-call `profile/full` dossiers (TikTok, Instagram, YouTube, X, Facebook, LinkedIn), `web/sessions`, `prism/voice` | **5** |
| `douyin/profile` | **6** |
| `search/forums`, `search/creators`, `naver/brief` | **10** |
| `prism/answers` | **15** |
| Universal Search (`search/everywhere`), the Content Analysis analytics, several Prism pulses | **20** |
| `web/agent`, `youtube/channel/about`, `douyin/trending`, `prism/earned-media` | **25** |
| The mid-weight Prism composites (`reputation`, `demand-signals`, `product-reviews`…) | **30** |
| `prism/campaign`, `prism/crisis-postmortem` | **35** |
| `prism/brand-mentions`, `prism/leads` | **50** |

**3. Metered — 71 endpoints.** The charge is computed from the params you send. The API **holds the ceiling up front and refunds down to the work actually done**, so budget against `max_credits` and expect to be charged less. Examples: `web/crawl` (1 per page crawled, holding `limit` up front), `prism/ai-visibility` (2–1,605, by prompts × runs × engines), `linkedin/profile/posts/archive` (5–500, 5 per post returned), `prism/post-stats` (1–500), `youtube/transcripts` (3–300 by batch size, every failed id refunded), the Douyin lanes (5–250 per row returned), `reddit/profile/comments` (2–200), and `prism/comments` (2–200 by comment page — but a flat 5 for an Instagram post URL, which no range can express).

**Other params that move the price.** A join is not the only one. `instagram/followers` and `instagram/following` take `coverage=full`, which walks a merged list so a page adds accounts an ordinary walk would miss — **10 credits a page instead of 5**, and a failed page is refunded. A plain walk of a follow list can stop at about two thirds of the account count (`data.total` on every page shows the gap), so this is the difference between a partial roster and a complete one. It needs `handle`, and a cursor from one mode only continues that mode. Every such param is listed with its own description and price effect in `List endpoints`.

> **Quoting a metered endpoint's base cost is wrong** — it is the floor, not the price. Run `action = "List pricing"` for the exact `min_credits` / `max_credits` band, the upfront hold, and the authored wording for how each meter ticks. Or set `dryRun: true` on the request you're about to make.

Every row that `List pricing` returns carries `pricing_model`, `credit_tier`, `credit_cost`, `ladder_cost`, `min_credits`, `max_credits`, `credits_held_upfront`, `hold_is_computed`, `metered_page_size`, the authored `pricing_description`, a plain-English `pricing_note`, the `cache_ttl_seconds` window, whether the endpoint is `paginatable`, and — new — `has_row_join`, `row_join_extra_credits_max` and the full `row_joins` catalogue. A budget can be built without a single API call.

### Row joins (`include=…`) — one call instead of N+1

28 endpoints declare a row join: they accept an **`include`** token that runs a second lookup against every row they just returned and folds the result into the same response. A Pinterest search that normally carries no save counts returns all 18 rows with `engagement.saves` filled. A LinkedIn people search returns exact follower counts instead of rounded ones. A YouTube list carries each channel's subscriber count.

This is the main reason an endpoint's band is wide, and the band's two ends are **two different calls**, not two outcomes of one:

| Endpoint | Plain call | With the join | Token(s) | What the join fills |
|----------|-----------:|--------------:|----------|---------------------|
| `pinterest/search` | 1 | up to **26** | `engagement` | saves, likes, comments, shares, date |
| `youtube/search` | 1 | up to **11** | `engagement`, `channel` | views/likes/comments/duration; subscriber count |
| `linkedin/search/people` | 10 | up to **50** | `profile` | exact follower count (replaces the rounded one) |
| `instagram/similar` | 5 | up to **85** | `profile` | follower counts and bios |
| `tiktok/search/users` | 1 | up to **31** | `profile` | full profile per account |
| `reddit/subreddits/search` | 1 | up to **26** | `details` | subscriber counts and community details |
| `threads/search` | 1 | up to **21** | `engagement` | view counts and pinned flags |
| `threads/user/posts` | 1 | up to **16** | `engagement` | view counts and pinned flags |
| `facebook/events` | 1 | up to **13** | `details` | full event records |
| `instagram/post/stats` | 5 | up to **9** | `saves` | save count and repost count |

**How it bills.** The call holds a per-row rate up front and **keeps only the rows it actually filled from a fresh read**. Rows served from the sibling endpoint's own cache are free; rows it could not fill are refunded. So the ceiling is what you budget and the floor is what you usually pay. Read `data.hydration` on the response for the rows attempted, the credits held and kept, and the seconds the join added — this Actor lifts those onto every dataset row as `_sc_hydration_*`.

**Each token is priced on its own.** The registry declares every join separately — which endpoint fills the rows, the exact leaves it fills, the per-row rate, the row cap, and the batch cap where one applies. So `include=engagement` on a YouTube list costs up to 5 extra credits, not the 10 that both tokens together would; `limit=10` on a Pinterest search caps the join at 10 rows, not 25; and `instagram/similar` joins its top 20 by default, reaching all 80 only when you ask for them. `dryRun` quotes the call you configured, token by token.

**A wide band is not always the join.** Four endpoints meter for a second reason as well — `threads/user/posts` spans 1–165 credits because a wide `limit` reads a second source, and only 16 of that ceiling is the join. `Row joins` reports `extra_credits_max` (the join alone) next to `endpoint_max_credits` (everything the endpoint can charge), because budgeting off the wrong one misleads in both directions.

**Why use it.** Doing the same work by hand is one page read plus one lookup per row — N+1 requests, the same credits or more, and you assemble the join yourself. It also adds latency (typically 3–12s), so it is opt-in.

**How to find them.** `action = "Row joins"` lists all 28 with the plain price, the joined ceiling, every token and what each one fills in — free, no API key. `dryRun: true` prices the exact call you are about to make: it quotes the plain price unless your params actually ask for the join.

```json
{ "action": "listRowJoins", "allPlatforms": true }
```
```json
{ "apiKey": "sc_...", "platform": "pinterest", "resource": "search",
  "params": { "query": "home decor ideas", "limit": 10, "include": "engagement" }, "dryRun": true }
```

**Free (0-credit) routes:** the utility discovery endpoints, the stateful Web Scraping control endpoints (listing/getting/cancelling/deleting jobs, monitors, and sessions), `prism/lookup` (it charges the resolved endpoint's own price with no routing surcharge), every monitors management call, and the whole cohort lifecycle except the query itself. Creating a monitor is free; each **scheduled run** bills its recipe's normal cost **plus 1 credit** for orchestration.

**Cache hits and idempotent replays cost 0 credits**, and credits are **auto-refunded** on upstream errors, empty results, request timeouts, and circuit-breaker trips. You always see `credits_used` and `credits_remaining` in every response. New accounts get **100 free credits**; paid plans start at **5,000 credits / £14·mo**. Check your balance with `action = "Check credit balance"`, and pull the **dispute-grade receipts** — every deduction and refund, keyed by `request_id`, with the `balance_after` each one committed — with `action = "Credit ledger"`. Both are free.

**Auto-pagination bills per page.** `maxItems` makes one billed request per page against the 197 endpoints that support a cursor. `maxPages` is the safety net — leave it low until you know what a page costs.

---

## Supported platforms

| Platform | Endpoints | Platform | Endpoints |
|----------|----------:|----------|----------:|
| LinkedIn | 45 | Rumble | 5 |
| Instagram | 37 | Target | 5 |
| TikTok | 36 | TikTok Shop | 5 |
| Prism | 33 | Walmart | 5 |
| YouTube | 29 | Yelp | 5 |
| Facebook | 24 | Apple Music | 4 |
| Web Scraping | 22 | Etsy | 4 |
| US Congress Trades | 19 | Hacker News | 4 |
| Klarna | 18 | Home Depot | 4 |
| Tripadvisor | 16 | Tavily | 4 |
| Twitter/X | 15 | Twitch | 4 |
| Naver | 14 | Universal Search | 4 |
| Reddit | 14 | Utility | 4 |
| GitHub | 12 | Bluesky | 3 |
| Gumtree | 11 | Google Trends | 3 |
| Jobs | 11 | Kwai | 3 |
| Sephora | 11 | Telegram | 3 |
| Content Analysis | 10 | Truth Social | 3 |
| Google | 10 | Wayfair | 3 |
| AliExpress | 9 | eBay | 2 |
| Apple App Store | 9 | Snapchat | 2 |
| Google Play | 9 | Trustpilot | 2 |
| Amazon | 8 | Google News | 1 |
| Douyin | 8 | Kick | 1 |
| Finance | 7 | Komi | 1 |
| G2 | 7 | LinkBio | 1 |
| Quora | 7 | LinkMe | 1 |
| H&M | 6 | Linktree | 1 |
| Spotify | 6 | On-Page | 1 |
| Threads | 6 | Perplexity | 1 |
| Google Shopping | 5 | Pillar | 1 |
| Kohl's | 5 | Polymarket | 1 |
| Pinterest | 5 |  |  |

*65 platforms, 575 endpoints. Counts reflect the bundled registry snapshot. Two stateful families sit outside that count and are available as their own platforms: **Monitors** (8 operations, `platform = "monitors"`) and **Cohorts** (8 operations, `platform = "cohorts"`). Run `action = "List platforms"` for the live list, or `action = "Check for updates"` to see whether this snapshot has drifted from the API.*

---

## Cohorts — audience-filtered mention search

Every other surface in this Actor asks *"who is talking about X?"*. Cohorts asks
the narrower question: **"which of _these specific people_ is talking about
X?"** You upload a panel you already have — a purchaser list, a customer
segment, a creator roster — and get back the matching posts per member, plus a
coverage record for every member including the ones that matched nothing.

Set `platform = "cohorts"` and pick a resource. Eight operations, four steps:

| Step | `resource` | Method | Cost |
|------|-----------|--------|-----:|
| 1. Create the panel | `create` | `POST` | **0** |
| 2. Upload identities (repeat per 1,000) | `members` | `PUT` | **0** |
| 3. Submit the query — returns `202` + a `query_id` | `query` | `POST` | **metered** |
| 4a. Poll until `succeeded` | `query/status` | `GET` | **0** |
| 4b. Read the matches + coverage | `query/results` | `GET` | **0** |
| — Inspect the panel | `get` | `GET` | **0** |
| — Stop a running query | `query/cancel` | `DELETE` | **0** |
| — Delete the panel and everything under it | `delete` | `DELETE` | **0** |

**Supported identity platforms:** Instagram, TikTok, YouTube, X/Twitter,
Threads, Bluesky, Truth Social, Kwai, Twitch, LinkedIn. Anything else is
rejected at upload, so an unsupported identity can never consume a reservation.

```json
{ "platform": "cohorts", "resource": "create", "params": { "name": "August purchaser panel", "retention_days": 30 } }
```
```json
{
  "platform": "cohorts",
  "resource": "members",
  "params": {
    "cohort_id": "ziJygy91eDlzFJLzzUgIY",
    "members": [
      { "external_id": "buyer_01983", "platform": "instagram", "handle": "natgeo" },
      { "external_id": "buyer_04711", "platform": "youtube", "handle": "mkbhd" }
    ]
  }
}
```
```json
{
  "platform": "cohorts",
  "resource": "query",
  "params": {
    "cohort_id": "ziJygy91eDlzFJLzzUgIY",
    "keywords": ["acme", "acme pro"],
    "date_from": "2026-08-01T00:00:00.000Z",
    "max_pages_per_identity": 3,
    "max_items_per_identity": 100,
    "max_credits": 30000
  }
}
```
```json
{ "platform": "cohorts", "resource": "query/results", "params": { "query_id": "ziJygy91eDlzFJLzzUgIY" }, "maxItems": 5000 }
```

**Three things worth knowing before you run one:**

- **`coverage` is the important field.** It has one record per member whether or
  not it matched, which is what stops a partial crawl from reading as "nobody
  talked about you". `window_complete: false` means the page budget ran out or
  the account was unreachable — there may be posts you did not see.
- **Billing is per successful upstream page**, never per member. Submission
  reserves the computed worst-case ceiling and fails *before* holding anything
  if that exceeds the `max_credits` you set. Failed, timed-out and cancelled
  pages cost nothing, and the unspent reservation is refunded exactly once.
  Reading results is free, so set `maxItems` high and walk every page.
- **`create`, `members` and `query` require an `Idempotency-Key`.** Leave the
  `idempotencyKey` input blank and the Actor generates one per run (logged, so
  you can reuse it); pin it to a fixed UUID and a re-run replays the original
  call instead of creating a second cohort or reserving a second query.

Matching is deterministic code, not a model: Unicode-normalized, case-folded,
whole-word only. `acme` matches "my acme review" but not "acmecorp" — no
stemming, fuzzy matching or brand-alias inference. If you want both, pass both.

---

## Common use cases

- **Influencer & creator research** — pull follower counts, engagement, and recent posts across networks for outreach and vetting.
- **Brand & competitor monitoring** — track mentions, comments, and sentiment across social and the open web; schedule it with `platform = "monitors"` and get a webhook when a number moves.
- **Market & product research** — Amazon/Walmart/Target/eBay/Etsy/Klarna/AliExpress/Sephora/Google Shopping product data, price history and reviews; app-store ratings and reviews; G2 software reviews.
- **Panel research** — upload a purchaser panel or creator roster and ask which of *those* accounts posted about your keywords, with per-member coverage (`platform = "cohorts"`).
- **Finance & policy research** — quotes, statements and options chains, plus the full US Congress trade-disclosure dataset with late-filing analytics.
- **Talent & labour-market analysis** — job search across four boards plus salary benchmarks by title and country.
- **AI agents & RAG** — feed normalized social data into agents; the unified schema means one parser, not forty.
- **Trend discovery** — Universal Search surfaces what's being said about a topic everywhere at once.
- **One call instead of N+1** — on 28 endpoints, `include=…` joins a second source onto every row of the result: engagement on a Pinterest or Threads search, exact follower counts on a LinkedIn people search, subscriber counts on a YouTube list. Same credits or fewer than doing it by hand, one request instead of one per row.

---

## FAQ

**Do I need a SocialCrawl account?** Yes — the Actor uses *your* SocialCrawl API key so you control credits and data. Signup is free with 100 credits at [socialcrawl.dev](https://www.socialcrawl.dev).

**Is my API key safe?** Yes. `apiKey` is a **secret input** — Apify encrypts it and never displays it in logs or the run's stored input.

**I'm an AI agent / building one — what's the fastest way to learn this API?** Run `action = "Agent context"`. It returns SocialCrawl's `llms.txt` corpus from the live API and saves it to the key-value store as `AGENT_CONTEXT.md` — a real markdown file you can paste into a system prompt or commit to a repo. One call, 0 credits, no docs scraping. Follow it with `action = "Quickstart"` for the machine-readable envelope, billing and error contracts.

**How do I know this Actor's endpoint list is still current?** Run `action = "Check for updates"` (free). It diffs the live catalog against the catalog bundled into this Actor and reports every difference — new endpoints, withdrawn ones, price changes, parameter changes. Where they disagree, the API is right.

**How do I discover endpoints?** Run `action = "Search endpoints"` with a keyword (it searches paths, prose, parameter names and the registry's own topic tags, so `ads` reaches every ad library), or `action = "List endpoints"` with a platform — no key required. Both return every endpoint with its method, credit band, pricing note, cache window, pagination support, and full parameter detail. For a pricing catalog across all platforms, run `action = "List pricing"` with `allPlatforms` ticked. Or browse the [API docs](https://www.socialcrawl.dev/docs).

**How do I know what a call will cost before I make it?** Set `dryRun: true`. The Actor resolves the endpoint, validates your parameters, and reports the credit band (including the auto-pagination multiplier) without calling the API. It prices **the call you configured**, not the endpoint in general: on a [row-join](#row-joins-include--one-call-instead-of-n1) endpoint a plain `pinterest/search` is quoted at 1 credit, the same call with `include=engagement` at up to 26, and with `limit=10` alongside it at up to 11 — because that is what the registry says the join holds.

**Why did a call cost 0 credits?** It was a cache hit, an idempotent replay, or one of the free routes — the 18 free registry endpoints (utility discovery and the web job/monitor control calls), every monitors management call, or the cohort lifecycle outside the query itself. Run `action = "Credit ledger"` to see exactly what was and was not charged, keyed by `request_id`.

**How do I reconcile a charge?** `action = "Credit ledger"` returns the `credit_transaction` rows the billing system wrote: deductions negative, refunds positive, each with the `balance_after` it committed and the `request_id` that produced it. Pass `{"request_id": "req-…"}` in `params` for a single request's receipt, or set `maxItems` to page through the ledger. It costs 0 credits.

**How do I use the stateful routes with methods like POST, PUT or DELETE?** Most endpoints resolve their method automatically — just set the `platform` and a `resource` (e.g. `web` + `scrape`, or `cohorts` + `members`). Only the few resources shared across verbs (e.g. `web/monitors/{monitor_id}` is GET/PATCH/DELETE) need the `method` input set. For path-template resources, pass the id (`job_id`, `monitor_id`, `session_id`, `cohort_id`, `query_id`) as a normal parameter.

**What's the difference between Monitors and Cohorts?** Monitors are about *time* — re-run one recipe on a cadence and watch a number move. Cohorts are about *audience* — run one bounded query across a panel of identities you supply. Monitors bill per scheduled run; cohorts bill per successful upstream page.

**How do monitors differ from Apify's scheduler?** Apify's scheduler re-runs this Actor. A SocialCrawl monitor runs server-side: it re-runs the recipe on its cadence, evaluates alert rules, keeps a time-series, and posts a signed webhook — even when no Actor run is happening. Use whichever fits; they compose fine.

**Can I schedule this?** Yes — use Apify's scheduler, webhooks, and integrations (Zapier, Make, n8n) like any other Actor.

---

## Links

- 🔑 **Get a free API key:** https://www.socialcrawl.dev
- 📖 **API documentation:** https://www.socialcrawl.dev/docs
- 🧭 **Explorer (try endpoints in-browser):** https://www.socialcrawl.dev/explorer
- 💳 **Billing & credits:** https://www.socialcrawl.dev/dashboard/billing

---

*SocialCrawl is an independent unified social media data API. Platform names and trademarks belong to their respective owners; this Actor accesses publicly available data on your behalf and is not affiliated with or endorsed by any platform listed.*
