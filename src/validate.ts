import { findPlatform } from "./data/platforms.js";
import { findEndpoints } from "./data/endpoints.js";
import type { Endpoint, HttpMethod } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  /** Resolved endpoint metadata when valid (method, credit cost, archetype, etc.). */
  endpoint?: Endpoint;
  /** Actionable error string when invalid. */
  error?: string;
}

/** Present = a non-empty value was supplied for this param. */
function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/**
 * Validates a request against the bundled registry snapshot BEFORE hitting the
 * network — so obvious mistakes (unknown platform, wrong resource, wrong/missing
 * method, missing required params) never burn the user's credits. Mirrors the
 * local validation in socialcrawl-mcp's `request` tool.
 *
 * `method` disambiguates the handful of web resources exposed under several
 * verbs (e.g. `web/monitors/{monitor_id}` is GET, PATCH, and DELETE). Leave it
 * undefined for the single-method majority.
 */
export function validateRequest(
  platform: string,
  resource: string,
  params: Record<string, unknown>,
  method?: HttpMethod,
): ValidationResult {
  const platformInfo = findPlatform(platform);
  if (!platformInfo) {
    return {
      valid: false,
      error: `Unknown platform "${platform}". Run the Actor with action "List platforms" to see all available platform slugs.`,
    };
  }

  const candidates = findEndpoints(platform, resource);
  if (candidates.length === 0) {
    return {
      valid: false,
      error: `Unknown resource "${resource}" for platform "${platform}". Run the Actor with action "List endpoints" (platform "${platform}") to see valid resources.`,
    };
  }

  let endpoint: Endpoint | undefined;
  if (method) {
    endpoint = candidates.find((e) => e.method === method);
    if (!endpoint) {
      const available = candidates.map((e) => e.method).join(", ");
      return {
        valid: false,
        error: `Resource "${platform}/${resource}" does not support method ${method}. Available method(s): ${available}. Change the "method" input.`,
      };
    }
  } else if (candidates.length === 1) {
    endpoint = candidates[0];
  } else {
    const available = candidates.map((e) => e.method).join(", ");
    return {
      valid: false,
      error: `Resource "${platform}/${resource}" is exposed under multiple methods (${available}). Set the "method" input to choose one.`,
    };
  }

  const missing: string[] = [];

  for (const p of endpoint!.params) {
    if (p.required && !hasValue(params[p.name])) {
      missing.push(`\`${p.name}\` (e.g. "${p.example}")`);
    }
  }

  for (const group of endpoint!.oneOfGroups) {
    const satisfied = group.some((name) => hasValue(params[name]));
    if (!satisfied) {
      missing.push(`one of ${group.map((n) => `\`${n}\``).join(", ")}`);
    }
  }

  if (missing.length > 0) {
    return {
      valid: false,
      error: `Missing required parameter(s): ${missing.join(", ")}. Run action "List endpoints" (platform "${platform}") for full parameter details.`,
    };
  }

  return { valid: true, endpoint: endpoint! };
}
