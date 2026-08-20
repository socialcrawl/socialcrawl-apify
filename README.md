<img src="https://www.socialcrawl.dev/images/sc-logo-text.png" alt="SocialCrawl" height="56" />

# SocialCrawl — Unified Social Media Data API

**One API key for every social platform.** Scrape and search **48 platforms across 381 endpoints** — TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Amazon, Walmart, Target, Google, the App Stores and many more — through a single, consistent response envelope. Plus a **universal cross-platform social search** that fans out across 14 networks in one call, **Prism composites** that fold many platforms into one unified report, a full **web-scraping suite** (scrape, crawl, extract, search, monitor), and **scheduled monitors** that re-run any endpoint on a cadence and post each result to your webhook.

This Actor is a thin, reliable wrapper around the [SocialCrawl API](https://www.socialcrawl.dev). You bring your own SocialCrawl API key (100 free credits on signup, no credit card), pick a platform and endpoint, and get back clean, normalized JSON — straight into an Apify dataset you can export to CSV, JSON, Excel, or pipe into your own pipelines, integrations, and AI agents.

> **Why it exists:** most social data tools force you to wire up a different scraper, auth flow, and JSON shape for every platform. SocialCrawl replaces a dozen fragmented integrations with **one key, one envelope, one credit system.** This Actor brings that unified surface to the Apify platform — with Apify's scheduling, storage, webhooks, and integrations on top.

---

## What you can do

- **Learn the API for free** — four 0-credit actions that answer from the live API, not from a snapshot: **Quickstart** (auth, envelope, credit model, every error code, rate limits, a working first call), **Endpoint guide** (one endpoint's full instructions, with a copy-paste curl and an example response), **Agent context** (the `llms.txt` corpus, saved as a `.md` file your AI agent can ingest), and **Check for updates** (does this Actor's bundled catalog still match the API?). See [Learning the API](#learning-the-api-free) below.
- **Profiles & posts** — fetch a creator's profile, post/video list, followers, and engagement stats from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Threads, Pinterest, Twitch, Bluesky, and more.
- **Comments & replies** — pull comment trees for a post, video, or thread.
- **Search** — keyword, hashtag, and user search per platform.
- **Universal social search** — one query fanned out across 14 social platforms (up to 17 sources in hashtag mode), LLM-planned, fused, reranked, and clustered (`platform = Universal Search`, `resource = everywhere`), plus a fused forum search (`resource = forums`) and a multi-country news search (`resource = news`).
- **Prism composites** — server-side recipes that fan out across many platforms and fold the legs into one unified report: universal URL lookup, brand-mention and demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar, creator vetting, reputation, and video/app/product intelligence (`platform = Prism`).
- **Commerce & reviews** — Amazon, Walmart, Target, Home Depot, eBay, Google Shopping, Trustpilot and Tripadvisor product/business data and reviews.
- **App stores** — Google Play and Apple App Store app details, reviews, and charts.
- **Web research** — Perplexity and Tavily grounded answers; Google News, Google Finance & Google Trends; Naver (Korea's #1 portal, including Data Lab trends and Shopping insight); Hacker News; GitHub; prediction markets; cross-web brand-mention sentiment.
- **Web scraping** — scrape any URL to clean markdown/HTML, LLM-powered structured extraction, site mapping, async crawl & batch-scrape jobs, an autonomous web agent, page monitors with change detection, interactive browser sessions with remote code execution, and document parsing (`platform = Web Scraping`).
- **Scheduled monitors** — re-run any endpoint or Prism composite hourly, daily, weekly or on a cron; each run is delivered to an HMAC-signed webhook, checked against alert rules, and appended to a queryable time-series (`platform = Monitors`).
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
| **`action`** | `Run API request` (default); the free learning actions `Quickstart`, `Endpoint guide`, `Agent context`, `Check for updates`; the free browsing actions `List platforms`, `List endpoints`, `Search endpoints`, `List pricing`; or `Check credit balance`. Everything except `Run API request` costs **0 credits**. |
| **`platform`** | The platform to query, e.g. `tiktok`, `instagram`, `amazon`, `web`. Choose **Universal Search** to query many platforms at once, or **Monitors** to schedule a recurring run. |
| **`resource`** | The endpoint on that platform, e.g. `profile`, `profile/videos`, `video/comments`. For Universal Search use `everywhere`. Path-template resources (e.g. `jobs/{job_id}`) take their id as a normal parameter. |
| **`params`** | Parameters as JSON, e.g. `{ "handle": "charlidamelio" }` or `{ "query": "electric cars" }`. For `GET`/`DELETE` these become the query string; for `POST`/`PATCH` (web crawl, agent, monitors…) they're sent as a typed JSON body. |
| **`allPlatforms`** | For `List endpoints` / `List pricing`: ignore the Platform dropdown (which can never be empty) and return the whole catalog in one run. |
| **`query`** | Keyword(s) for `action = "Search endpoints"` — e.g. `comments`, `product reviews`, `transcript`. |
| **`format`** | For `action = "Agent context"`: `markdown` (the llms.txt corpus, also saved as a `.md` file) or `json` (the same content, structured). |
| **`maxItems`** | *(Pagination)* `0` = a single request. Higher, and the Actor follows the API's `next_cursor` until it has this many items. **Each page is a separate billed call.** |
| **`maxPages`** | *(Pagination)* Hard ceiling on billed page requests, whatever `maxItems` says. Default 20, max 500. |
| **`dryRun`** | *(Advanced)* Validate and price the request without calling the API or spending a credit. |
| **`method`** | *(Optional)* Leave blank — resolves automatically. Only set it for the stateful Web Scraping routes that share one resource across several verbs (e.g. `monitors/{monitor_id}` is `GET`, `PATCH`, or `DELETE`). |
| **`idempotencyKey`** | *(Optional, advanced)* A UUIDv4 that makes retries safe — replays within 24h charge 0 new credits. |
| **`baseUrl`** | *(Optional, advanced)* Override the API origin. Defaults to `https://www.socialcrawl.dev`. |

**Not sure what to put in `resource` / `params`?** Run `action = "Search endpoints"` with a keyword, or `action = "List endpoints"` with a platform. Both return every endpoint with its public path, HTTP method, credit band + pricing note, cache window, whether it can be auto-paginated, and **every parameter** with its type, allowed values, numeric bounds, coupling rules, description and example. For a pure pricing catalog across all 381 endpoints, use `action = "List pricing"` with `allPlatforms` ticked.

## Learning the API (free)

SocialCrawl documents itself *through the API*. Four endpoints on the `utility`
platform are generated from the live registry at request time, so they can never
drift from what is actually callable — and all four cost **0 credits**. This
Actor exposes each as a first-class action.

| Action | Answers | Saved to |
|--------|---------|----------|
| **Quickstart** | How do I configure and call this API? Auth header, base URL, the response envelope, the credit model, the **complete error taxonomy** (one dataset row per code, with its HTTP status and what it means), rate limits, the pagination rule, and a working first request. | Dataset + `OUTPUT` |
| **Endpoint guide** | How exactly do I call *this* endpoint? Every parameter with type, description and example; the exact credit cost and billing rules; the cache window; the pagination recipe; a **copy-paste curl**; an example response; the response schema URL; and related endpoints. | Dataset + `OUTPUT` + `REQUEST_CURL` |
| **Agent context** | Give my AI agent everything it needs in one call — the same corpus as `llms.txt`, for the whole API or one platform. | Dataset + `OUTPUT` + **`AGENT_CONTEXT.md`** (a real markdown file) |
| **Check for updates** | Is this Actor's bundled catalog still current? Diffs the live catalog against the snapshot the Actor validates against and reports every difference: new endpoints, withdrawn ones, price changes, parameter changes, pagination changes. | Dataset + `OUTPUT` |

These four need your API key (every SocialCrawl route is authenticated) but never
charge a credit. The four **Browse** actions need no key at all — they answer
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

---

## Output

Each result item is pushed to the Actor's **dataset**:

- **List responses** (posts, comments, search results…) become **one row per item**.
- **Single-object responses** (a profile, an app, a product…) become **one row**.
- Every row carries credit/request metadata under `_sc_`-prefixed fields (`_sc_platform`, `_sc_endpoint`, `_sc_credits_used`, `_sc_credits_remaining`, `_sc_request_id`, `_sc_cached`, and `_sc_page` when auto-paginating) so it never collides with platform data fields.

The **complete, untouched API envelope** is also saved to the run's **key-value store** as `OUTPUT` — useful when you want the raw nested response plus exact credit accounting. An auto-paginated run stores every page's envelope plus a `stop_reason` and the `next_cursor` you'd resume from.

Export the dataset to **JSON, CSV, Excel, XML, or RSS**, or fetch it via the Apify API.

---

## Pricing & credits

This Actor is **free on Apify** — you only pay Apify's standard platform usage (compute is tiny; most calls finish in seconds on the minimum memory setting).

The **data itself is billed by SocialCrawl** against your own API key. Endpoints price in one of three shapes, and the difference matters when you're sizing a run:

**1. The tier ladder — 294 endpoints.** A fixed price per call.

| Tier | Credits | Examples |
|------|--------:|----------|
| Standard | **1** | Most profile/post/comment/search endpoints; web scrape/map/crawl/batch-scrape/parse |
| Advanced | **5** | Analytics-heavy endpoints, ad libraries, commerce catalogues, structured web extraction |
| Premium | **10** | Video/audio transcripts (except YouTube) and the heaviest single-call endpoints |

**2. Flat overrides — 61 endpoints.** A per-endpoint price off the ladder, e.g.:

| Endpoint(s) | Credits |
|-------------|--------:|
| Universal Search (`search/everywhere`) | **20** |
| Content Analysis analytic endpoints | **20** each |
| YouTube video transcript | **3** |
| Web agent (`web/agent`) | **25** |
| Prism composites | **5–50** per recipe |
| Utility discovery + stateful job/monitor/session control routes | **0** |

**3. Metered — 26 endpoints.** The charge is computed from the params you send. The API **holds the ceiling up front and refunds down to the work actually done**, so budget against `max_credits` and expect to be charged less. Examples: `prism/comments` (2–200, by comment page — but a flat 5 for an Instagram post URL), `search/news` (2–14, by country/angle leg), `web/crawl` (1 per page crawled, holding `limit` up front), `youtube/videos` (5–100 by batch size).

> **Quoting a metered endpoint's base cost is wrong** — it is the floor, not the price. Run `action = "List pricing"` for the exact `min_credits` / `max_credits` band, the upfront hold, and the authored wording for how each meter ticks. Or set `dryRun: true` on the request you're about to make.

**Free (0-credit) routes:** the utility discovery endpoints, the stateful Web Scraping control endpoints (listing/getting/cancelling/deleting jobs, monitors, and sessions), and every monitors management call. Creating a monitor is free; each **scheduled run** bills its recipe's normal cost **plus 1 credit** for orchestration.

**Cache hits and idempotent replays cost 0 credits**, and credits are **auto-refunded** on upstream errors, empty results, request timeouts, and circuit-breaker trips. You always see `credits_used` and `credits_remaining` in every response. New accounts get **100 free credits**; paid plans start at **5,000 credits / £14·mo**. Check your balance any time with `action = "Check credit balance"`.

**Auto-pagination bills per page.** `maxItems` makes one billed request per page against the 127 endpoints that support a cursor. `maxPages` is the safety net — leave it low until you know what a page costs.

---

## Supported platforms

| Platform | Endpoints | Platform | Endpoints |
|----------|----------:|----------|----------:|
| LinkedIn | 44 | Hacker News | 4 |
| Instagram | 33 | Tavily | 4 |
| Prism | 33 | Twitch | 4 |
| YouTube | 28 | Utility | 4 |
| Facebook | 23 | Bluesky | 3 |
| Web Scraping | 22 | Google Finance | 3 |
| TikTok | 21 | Kwai | 3 |
| Naver | 14 | Truth Social | 3 |
| GitHub | 12 | Universal Search | 3 |
| Content Analysis | 10 | eBay | 2 |
| Google | 10 | Google Trends | 2 |
| Apple App Store | 9 | Home Depot | 2 |
| Google Play | 9 | Tripadvisor | 2 |
| Reddit | 8 | Trustpilot | 2 |
| Twitter/X | 8 | Google News | 1 |
| Spotify | 6 | Kick | 1 |
| Threads | 6 | Komi | 1 |
| Amazon | 5 | LinkBio | 1 |
| Pinterest | 5 | LinkMe | 1 |
| Rumble | 5 | Linktree | 1 |
| Target | 5 | Perplexity | 1 |
| TikTok Shop | 5 | Pillar | 1 |
| Walmart | 5 | Polymarket | 1 |
| Google Shopping | 4 | Snapchat | 1 |

*48 platforms, 381 endpoints. Counts reflect the bundled registry snapshot. The **Monitors** family (8 operations) sits outside the registry count and is available as `platform = "monitors"`. Run `action = "List platforms"` for the live list.*

---

## Common use cases

- **Influencer & creator research** — pull follower counts, engagement, and recent posts across networks for outreach and vetting.
- **Brand & competitor monitoring** — track mentions, comments, and sentiment across social and the open web; schedule it with `platform = "monitors"` and get a webhook when a number moves.
- **Market & product research** — Amazon/Walmart/Target/eBay/Google Shopping product data and reviews; app-store ratings and reviews.
- **AI agents & RAG** — feed normalized social data into agents; the unified schema means one parser, not forty.
- **Trend discovery** — Universal Search surfaces what's being said about a topic everywhere at once.

---

## FAQ

**Do I need a SocialCrawl account?** Yes — the Actor uses *your* SocialCrawl API key so you control credits and data. Signup is free with 100 credits at [socialcrawl.dev](https://www.socialcrawl.dev).

**Is my API key safe?** Yes. `apiKey` is a **secret input** — Apify encrypts it and never displays it in logs or the run's stored input.

**I'm an AI agent / building one — what's the fastest way to learn this API?** Run `action = "Agent context"`. It returns SocialCrawl's `llms.txt` corpus from the live API and saves it to the key-value store as `AGENT_CONTEXT.md` — a real markdown file you can paste into a system prompt or commit to a repo. One call, 0 credits, no docs scraping. Follow it with `action = "Quickstart"` for the machine-readable envelope, billing and error contracts.

**How do I know this Actor's endpoint list is still current?** Run `action = "Check for updates"` (free). It diffs the live catalog against the catalog bundled into this Actor and reports every difference — new endpoints, withdrawn ones, price changes, parameter changes. Where they disagree, the API is right.

**How do I discover endpoints?** Run `action = "Search endpoints"` with a keyword, or `action = "List endpoints"` with a platform — no key required. Both return every endpoint with its method, credit band, pricing note, cache window, pagination support, and full parameter detail. For a pricing catalog across all platforms, run `action = "List pricing"` with `allPlatforms` ticked. Or browse the [API docs](https://www.socialcrawl.dev/docs).

**How do I know what a call will cost before I make it?** Set `dryRun: true`. The Actor resolves the endpoint, validates your parameters, and reports the credit band (including the auto-pagination multiplier) without calling the API.

**Why did a call cost 0 credits?** It was a cache hit, an idempotent replay, or one of the 18 free routes (utility discovery, or a web job/monitor/session control call).

**How do I use the Web Scraping routes with methods like POST or DELETE?** Most endpoints resolve their method automatically — just set `platform = "web"` and a `resource` (e.g. `scrape`, `crawl`, `agent`). Only the few resources shared across verbs (e.g. `monitors/{monitor_id}` is GET/PATCH/DELETE) need the `method` input set. For path-template resources, pass the id (`job_id`, `monitor_id`, `session_id`) as a normal parameter.

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
