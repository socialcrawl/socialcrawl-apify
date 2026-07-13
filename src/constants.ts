export const DEFAULT_BASE_URL = "https://www.socialcrawl.dev";

/**
 * Request timeout. Generous because the universal-search endpoint
 * (`/v1/search/everywhere`) fans out across up to 15 sources and can take
 * tens of seconds. Standard single-platform calls return in 1–5s.
 */
export const TIMEOUT_MS = 120_000;

export const ACTOR_NAME = "socialcrawl-apify";
export const ACTOR_VERSION = "1.1.0";

export const SIGNUP_URL = "https://www.socialcrawl.dev";
export const DOCS_URL = "https://www.socialcrawl.dev/docs";
export const BILLING_URL = "https://www.socialcrawl.dev/dashboard/billing";
