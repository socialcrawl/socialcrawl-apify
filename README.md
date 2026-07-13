<img src="https://www.socialcrawl.dev/images/sc-logo-text.png" alt="SocialCrawl" height="56" />

# SocialCrawl — Unified Social Media Data API

**One API key for every social platform.** Scrape and search **44 platforms across 357 endpoints** — TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Amazon, Google, the App Stores and many more — through a single, consistent response envelope. Plus a **universal cross-platform social search** that fans out across a dozen networks in one call, **Prism composites** that fold many platforms into one unified report, a full **web-scraping suite** (scrape, crawl, extract, search, monitor), and **Google Trends** interest data.

This Actor is a thin, reliable wrapper around the [SocialCrawl API](https://www.socialcrawl.dev). You bring your own SocialCrawl API key (100 free credits on signup, no credit card), pick a platform and endpoint, and get back clean, normalized JSON — straight into an Apify dataset you can export to CSV, JSON, Excel, or pipe into your own pipelines, integrations, and AI agents.

> **Why it exists:** most social data tools force you to wire up a different scraper, auth flow, and JSON shape for every platform. SocialCrawl replaces a dozen fragmented integrations with **one key, one envelope, one credit system.** This Actor brings that unified surface to the Apify platform — with Apify's scheduling, storage, webhooks, and integrations on top.

---

## What you can do

- **Profiles & posts** — fetch a creator's profile, post/video list, followers, and engagement stats from TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Threads, Pinterest, Twitch, Bluesky, and more.
- **Comments & replies** — pull comment trees for a post, video, or thread.
- **Search** — keyword, hashtag, and user search per platform.
- **Universal social search** — one query fanned out across 12+ social platforms, LLM-planned, fused, reranked, and clustered (`platform = Universal Search`, `resource = everywhere`), plus a fused forum search across Reddit, Hacker News, and Korean forums (`resource = forums`).
- **Prism composites** — server-side recipes that fan out across many platforms and fold the legs into one unified report: universal URL lookup, brand-mention and demand nowcasts, AI share-of-voice / GEO monitoring, crisis radar, creator vetting, reputation, and video/app/product intelligence (`platform = Prism`).
- **Commerce & reviews** — Amazon, Google Shopping, Trustpilot, Tripadvisor product/business data and reviews.
- **App stores** — Google Play and Apple App Store app details, reviews, and charts.
- **Web research** — Perplexity and Tavily grounded answers; Google News, Google Finance & Google Trends; Naver (Korea's #1 portal); Hacker News; GitHub; prediction markets; cross-web brand-mention sentiment.
- **Web scraping** — scrape any URL to clean markdown/HTML, LLM-powered structured extraction, site mapping, async crawl & batch-scrape jobs, an autonomous web agent, scheduled page monitors with change detection, interactive browser sessions with remote code execution, and document parsing (`platform = Web Scraping`).
- **Transcripts** — AI-powered video/audio transcripts for TikTok, Instagram, YouTube, and more.

See the full, always-current endpoint list by running the Actor with **action = "List endpoints"** (no API key required).

---

## Quick start

1. **Try it with no setup.** Just click **Start** — with no API key, the Actor returns the full catalog of supported platforms so you can see what's available.
2. **Get a free API key.** Sign up at **[socialcrawl.dev](https://www.socialcrawl.dev)** — you get 100 free credits, no credit card.
3. **Paste the key** into the `apiKey` field, keep the pre-filled TikTok `@charlidamelio` example (or change it), and hit **Start**.
4. **Read your results** in the **Dataset** tab, or export them to CSV / JSON / Excel.

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
| **`action`** | `Run API request` (default), `List platforms`, `List endpoints`, `List pricing`, or `Check credit balance`. The three "List" actions need no API key. |
| **`platform`** | The platform to query, e.g. `tiktok`, `instagram`, `amazon`, `web`. Choose **Universal Search** to query many platforms at once. |
| **`resource`** | The endpoint on that platform, e.g. `profile`, `profile/videos`, `video/comments`. For Universal Search use `everywhere`. Path-template resources (e.g. `jobs/{job_id}`) take their id as a normal parameter. |
| **`method`** | *(Optional)* Leave blank — resolves automatically. Only set it for the stateful Web Scraping routes that share one resource across several verbs (e.g. `monitors/{monitor_id}` is `GET`, `PATCH`, or `DELETE`). |
| **`params`** | Parameters as JSON, e.g. `{ "handle": "charlidamelio" }` or `{ "query": "electric cars" }`. For `GET`/`DELETE` these become the query string; for `POST`/`PATCH` (web crawl, agent, monitors…) they're sent as a typed JSON body. |
| **`idempotencyKey`** | *(Optional, advanced)* A UUIDv4 that makes retries safe — replays within 24h charge 0 new credits. |
| **`baseUrl`** | *(Optional, advanced)* Override the API origin. Defaults to `https://www.socialcrawl.dev`. |

**Not sure what to put in `resource` / `params`?** Run the Actor with `action = "List endpoints"` and your chosen `platform` first — it returns every resource, its public path, HTTP method, credit cost + pricing note, and required/optional parameters. For a pure pricing catalog across every endpoint, use `action = "List pricing"` (no key needed).

### Example inputs

**TikTok profile:**
```json
{ "platform": "tiktok", "resource": "profile", "params": { "handle": "charlidamelio" } }
```

**YouTube video comments:**
```json
{ "platform": "youtube", "resource": "video/comments", "params": { "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ" } }
```

**Amazon product reviews:**
```json
{ "platform": "amazon", "resource": "reviews", "params": { "asin": "B09G9FPHY6", "country": "US" } }
```

**Universal social search (one query, many platforms):**
```json
{ "platform": "search", "resource": "everywhere", "params": { "query": "best running shoes 2026" } }
```

**Scrape a web page to clean markdown:**
```json
{ "platform": "web", "resource": "scrape", "params": { "url": "https://example.com", "formats": "markdown" } }
```

**Google Trends — rising related queries:**
```json
{ "platform": "google_trends", "resource": "rising", "params": { "keyword": "electric cars" } }
```

---

## Output

Each result item is pushed to the Actor's **dataset**:

- **List responses** (posts, comments, search results…) become **one row per item**.
- **Single-object responses** (a profile, an app, a product…) become **one row**.
- Every row carries credit/request metadata under `_sc_`-prefixed fields (`_sc_platform`, `_sc_endpoint`, `_sc_credits_used`, `_sc_credits_remaining`, `_sc_request_id`, `_sc_cached`) so it never collides with platform data fields.

The **complete, untouched API envelope** is also saved to the run's **key-value store** as `OUTPUT` — useful when you want the raw nested response plus exact credit accounting.

Export the dataset to **JSON, CSV, Excel, XML, or RSS**, or fetch it via the Apify API.

---

## Pricing & credits

This Actor is **free on Apify** — you only pay Apify's standard platform usage (compute is tiny; most calls finish in seconds on the minimum memory setting).

The **data itself is billed by SocialCrawl** against your own API key, using a simple, transparent credit system:

| Tier | Credits | Examples |
|------|--------:|----------|
| Standard | **1** | Most profile/post/comment/search endpoints; web scrape/map/crawl/batch-scrape/parse |
| Advanced | **5** | Analytics-heavy endpoints, ad libraries, structured web extraction, lighter composites |
| Premium | **10** | Video/audio transcripts (except YouTube), age-gender, the heaviest composites |

**Flat-rate overrides** (outside the 1/5/10 ladder):

| Endpoint(s) | Credits |
|-------------|--------:|
| Universal Search (`search/everywhere`, `search/forums`) | **20** |
| Content Analysis analytic endpoints (search, summary, sentiment, rating-distribution, phrase-trends, category-trends) | **20** each |
| YouTube video transcript | **3** |
| Web agent (`web/agent`) | **25** |
| Prism composites | **5–50** per recipe (see each endpoint's `credit_cost`) |

**Free (0-credit) routes:** the stateful Web Scraping control endpoints — listing/getting/cancelling/deleting jobs, monitors, and sessions — cost nothing; you only pay for the work-producing create call.

**Cache hits and idempotent replays cost 0 credits**, and credits are **auto-refunded** on upstream errors, empty results, and circuit-breaker trips. You always see `credits_used` and `credits_remaining` in every response. New accounts get **100 free credits**; paid plans start at **5,000 credits / £14·mo**. Check your balance any time with `action = "Check credit balance"`, or price every endpoint up front with `action = "List pricing"`.

---

## Supported platforms

| Platform | Endpoints | Platform | Endpoints |
|----------|----------:|----------|----------:|
| Web Scraping | 22 | Google Trends | 2 |
| TikTok | 20 | Trustpilot | 2 |
| Instagram | 33 | Google Play | 9 |
| YouTube | 28 | Apple App Store | 9 |
| Twitter/X | 8 | Tripadvisor | 2 |
| LinkedIn | 44 | Utility | 1 |
| Facebook | 22 | Linktree / LinkBio / LinkMe / Komi / Pillar | 1 each |
| Reddit | 7 | Polymarket | 1 |
| Threads | 5 | Hacker News | 4 |
| Pinterest | 5 | GitHub | 12 |
| Twitch | 4 | Tavily | 4 |
| Snapchat | 1 | Naver | 12 |
| Truth Social | 3 | Rumble | 5 |
| Kick | 1 | Bluesky | 3 |
| Kwai | 3 | Spotify | 6 |
| TikTok Shop | 5 | **Universal Search** | **2** |
| Perplexity | 1 | Prism | 33 |
| Google | 10 | Content Analysis | 10 |
| Amazon | 5 | Google News | 1 |
| Google Shopping | 4 | Google Finance | 3 |

*44 platforms, 357 endpoints. Counts reflect the bundled registry snapshot. Run `action = "List platforms"` for the live list.*

---

## Common use cases

- **Influencer & creator research** — pull follower counts, engagement, and recent posts across networks for outreach and vetting.
- **Brand & competitor monitoring** — track mentions, comments, and sentiment across social and the open web.
- **Market & product research** — Amazon/Google Shopping product data and reviews; app-store ratings and reviews.
- **AI agents & RAG** — feed normalized social data into agents; the unified schema means one parser, not forty.
- **Trend discovery** — Universal Search surfaces what's being said about a topic everywhere at once.

---

## FAQ

**Do I need a SocialCrawl account?** Yes — the Actor uses *your* SocialCrawl API key so you control credits and data. Signup is free with 100 credits at [socialcrawl.dev](https://www.socialcrawl.dev).

**Is my API key safe?** Yes. `apiKey` is a **secret input** — Apify encrypts it and never displays it in logs or the run's stored input.

**How do I discover endpoints?** Run `action = "List endpoints"` with a `platform` — no key required. It returns every resource with its method, credit cost, pricing note, and parameters. For a full pricing catalog across all platforms, run `action = "List pricing"`. Or browse the [API docs](https://www.socialcrawl.dev/docs).

**Why did a call cost 0 credits?** It was a cache hit, an idempotent replay, or a free stateful-control route (listing/getting/cancelling a web job, monitor, or session) — all free.

**How do I use the Web Scraping routes with methods like POST or DELETE?** Most endpoints resolve their method automatically — just set `platform = "web"` and a `resource` (e.g. `scrape`, `crawl`, `agent`). Only the few resources shared across verbs (e.g. `monitors/{monitor_id}` is GET/PATCH/DELETE) need the `method` input set. For path-template resources, pass the id (`job_id`, `monitor_id`, `session_id`) as a normal parameter.

**Can I schedule this?** Yes — use Apify's scheduler, webhooks, and integrations (Zapier, Make, n8n) like any other Actor.

---

## Links

- 🔑 **Get a free API key:** https://www.socialcrawl.dev
- 📖 **API documentation:** https://www.socialcrawl.dev/docs
- 🧭 **Explorer (try endpoints in-browser):** https://www.socialcrawl.dev/explorer
- 💳 **Billing & credits:** https://www.socialcrawl.dev/dashboard/billing

---

*SocialCrawl is an independent unified social media data API. Platform names and trademarks belong to their respective owners; this Actor accesses publicly available data on your behalf and is not affiliated with or endorsed by any platform listed.*
