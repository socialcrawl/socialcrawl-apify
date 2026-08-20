import { ENDPOINTS } from "./data/endpoints.js";
import { MONITOR_ENDPOINTS, MONITOR_PLATFORM } from "./data/monitors.js";
import { PLATFORMS } from "./data/platforms.js";
import type { Endpoint, HttpMethod, Platform } from "./types.js";

/**
 * The single lookup surface over everything this Actor can call: the generated
 * registry snapshot plus the hand-written non-registry families.
 *
 * The two are kept apart in ./data so `npm run generate:data` can overwrite the
 * registry files wholesale, and merged here so nothing downstream has to know
 * which list an endpoint came from. Registry entries come first, so a platform
 * slug collision (there is none today) would resolve to the registry.
 */
export const ALL_PLATFORMS: Platform[] = [...PLATFORMS, MONITOR_PLATFORM];

export const ALL_ENDPOINTS: Endpoint[] = [...ENDPOINTS, ...MONITOR_ENDPOINTS];

export function findPlatform(slug: string): Platform | undefined {
  return ALL_PLATFORMS.find((p) => p.slug === slug);
}

export function getAllPlatformSlugs(): string[] {
  return ALL_PLATFORMS.map((p) => p.slug);
}

export function getEndpointsByPlatform(platform: string): Endpoint[] {
  return ALL_ENDPOINTS.filter((e) => e.platform === platform);
}

/**
 * All endpoints matching a platform + resource. Usually one, but the stateful
 * web routes expose the same resource under several HTTP methods (e.g.
 * `web/monitors/{monitor_id}` is GET, PATCH, and DELETE), so callers
 * disambiguate by method.
 */
export function findEndpoints(platform: string, resource: string): Endpoint[] {
  return ALL_ENDPOINTS.filter(
    (e) => e.platform === platform && e.resource === resource,
  );
}

/**
 * Resolve a single endpoint. When `method` is given it must match exactly;
 * otherwise the first (and, for all but the handful of method-ambiguous web
 * routes, only) match is returned.
 */
export function findEndpoint(
  platform: string,
  resource: string,
  method?: HttpMethod,
): Endpoint | undefined {
  const matches = findEndpoints(platform, resource);
  if (method) return matches.find((e) => e.method === method);
  return matches[0];
}

/** The public path for an endpoint, with `{token}` placeholders left in place. */
export function publicPath(e: Endpoint): string {
  return e.path ?? `/v1/${e.platform}/${e.resource}`;
}

/**
 * True when an endpoint returns a list the Actor can walk with the universal
 * `cursor`. `singlePage` endpoints advertise a pagination descriptor but serve
 * exactly one page, so following the cursor would re-bill for the same rows.
 */
export function isPaginatable(e: Endpoint): boolean {
  return Boolean(e.pagination) && !e.singlePage;
}

/**
 * Free-text search across the whole catalog. With 381 registry endpoints,
 * scanning one platform at a time is not a realistic way to find the right
 * call, so this ranks matches over the fields a person would actually search:
 * the path, the summary, the description, and the param names.
 *
 * Scoring is deliberately blunt — an exact `platform/resource` hit outranks a
 * path substring, which outranks a summary hit, which outranks prose. Terms are
 * ANDed: every term must appear somewhere in the endpoint's haystack.
 */
export function searchEndpoints(query: string, limit = 50): Endpoint[] {
  const terms = query
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];

  const scored: { endpoint: Endpoint; score: number }[] = [];

  for (const e of ALL_ENDPOINTS) {
    const path = `${e.platform}/${e.resource}`.toLowerCase();
    const summary = e.summary.toLowerCase();
    const description = e.description.toLowerCase();
    const paramNames = [
      ...e.params.map((p) => p.name),
      ...e.optionalParams.map((p) => p.name),
    ]
      .join(" ")
      .toLowerCase();
    const haystack = `${path} ${summary} ${description} ${paramNames}`;

    if (!terms.every((t) => haystack.includes(t))) continue;

    let score = 0;
    for (const t of terms) {
      if (path === t) score += 100;
      else if (path.includes(t)) score += 25;
      if (summary.includes(t)) score += 10;
      if (paramNames.includes(t)) score += 4;
      if (description.includes(t)) score += 1;
    }
    scored.push({ endpoint: e, score });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        `${a.endpoint.platform}/${a.endpoint.resource}`.localeCompare(
          `${b.endpoint.platform}/${b.endpoint.resource}`,
        ),
    )
    .slice(0, limit)
    .map((s) => s.endpoint);
}
