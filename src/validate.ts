import {
  findEndpoints,
  findPlatform,
  getEndpointsByPlatform,
  publicPath,
} from "./catalog.js";
import { COHORT_ID_PATTERN } from "./data/cohorts.js";
import { MONITOR_ID_PATTERN } from "./data/monitors.js";
import type { Endpoint, HttpMethod, OptionalParam } from "./types.js";

export interface ValidationResult {
  valid: boolean;
  /** Resolved endpoint metadata when valid (method, pricing, pagination, …). */
  endpoint?: Endpoint;
  /** Actionable error string when invalid. */
  error?: string;
  /**
   * Non-fatal problems worth telling the user about. Emitted even on a valid
   * request — the Actor logs them and still makes the call, because the bundled
   * registry snapshot can lag the live API and a stale local rule must never be
   * the reason a legitimate request is refused.
   */
  warnings: string[];
}

/** Present = a non-empty value was supplied for this param. */
function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}

/**
 * Universal inputs every list endpoint accepts, whether or not the snapshot
 * declares them: the API rewrites `cursor`/`limit` onto each endpoint's native
 * pagination params for you.
 */
const UNIVERSAL_PARAMS = new Set(["cursor", "limit"]);

function csvEntries(value: unknown): string[] {
  return String(value)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Check one optional param's declared value constraints. */
function checkOptionalParam(
  spec: OptionalParam,
  value: unknown,
  params: Record<string, unknown>,
  errors: string[],
): void {
  if (spec.enumValues && !spec.enumValues.includes(String(value))) {
    errors.push(
      `\`${spec.name}\` must be one of ${spec.enumValues.map((v) => `"${v}"`).join(", ")} — got "${String(value)}"`,
    );
  }

  if (spec.type === "integer") {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      errors.push(`\`${spec.name}\` must be a number — got "${String(value)}"`);
    } else {
      if (spec.minimum !== undefined && n < spec.minimum) {
        errors.push(`\`${spec.name}\` must be at least ${spec.minimum} — got ${n}`);
      }
      if (spec.maximum !== undefined && n > spec.maximum) {
        errors.push(`\`${spec.name}\` must be at most ${spec.maximum} — got ${n}`);
      }
    }
  }

  // Presence coupling: this param is a silent no-op upstream without its
  // sibling, so the API rejects it pre-billing rather than ignoring it.
  if (spec.requires && !hasValue(params[spec.requires])) {
    errors.push(
      `\`${spec.name}\` only takes effect alongside \`${spec.requires}\` — send both, or neither`,
    );
  }

  // Value coupling: an ABSENT companion is auto-injected by the API, so only a
  // present-but-conflicting companion is an error.
  if (spec.couplesWith) {
    const companion = params[spec.couplesWith.param];
    if (hasValue(companion) && String(companion) !== spec.couplesWith.value) {
      errors.push(
        `\`${spec.name}\` requires \`${spec.couplesWith.param}=${spec.couplesWith.value}\` — got \`${spec.couplesWith.param}=${String(companion)}\``,
      );
    }
  }
}

/**
 * Validates a request against the bundled registry snapshot BEFORE hitting the
 * network — so obvious mistakes (unknown platform, wrong resource, wrong or
 * ambiguous method, missing required params, out-of-range and mis-spelled
 * values) never burn the user's credits.
 *
 * `method` disambiguates the handful of resources exposed under several verbs
 * (e.g. `web/monitors/{monitor_id}` is GET, PATCH, and DELETE). Leave it
 * undefined for the single-method majority.
 */
export function validateRequest(
  platform: string,
  resource: string,
  params: Record<string, unknown>,
  method?: HttpMethod,
): ValidationResult {
  const warnings: string[] = [];

  const platformInfo = findPlatform(platform);
  if (!platformInfo) {
    return {
      valid: false,
      warnings,
      error: `Unknown platform "${platform}". Run the Actor with action "List platforms" to see every valid slug.`,
    };
  }

  const candidates = findEndpoints(platform, resource);
  if (candidates.length === 0) {
    const near = getEndpointsByPlatform(platform)
      .filter((e) => e.resource.includes(resource) || resource.includes(e.resource))
      .slice(0, 5)
      .map((e) => `"${e.resource}"`);
    const hint = near.length
      ? ` Did you mean ${near.join(", ")}?`
      : ` Run action "List endpoints" with platform "${platform}" to see valid resources.`;
    return {
      valid: false,
      warnings,
      error: `Unknown resource "${resource}" for platform "${platform}".${hint}`,
    };
  }

  let endpoint: Endpoint | undefined;
  if (method) {
    endpoint = candidates.find((e) => e.method === method);
    if (!endpoint) {
      const available = candidates.map((e) => e.method).join(", ");
      return {
        valid: false,
        warnings,
        error: `Resource "${platform}/${resource}" does not support method ${method}. Available method(s): ${available}. Change the "method" input.`,
      };
    }
  } else if (candidates.length === 1) {
    endpoint = candidates[0];
  }

  if (!endpoint) {
    const available = candidates.map((e) => e.method).join(", ");
    return {
      valid: false,
      warnings,
      error: `Resource "${platform}/${resource}" is exposed under multiple methods (${available}). Set the "method" input to choose one.`,
    };
  }

  const resolved: Endpoint = endpoint;
  const errors: string[] = [];
  // Non-registry families do not live at /v1/{platform}/{resource}, so quote
  // the route the request will actually take.
  const route = `${resolved.method} ${publicPath(resolved)}`;

  // ── Required params ──────────────────────────────────────────────────
  const missing: string[] = [];
  for (const p of resolved.params) {
    if (p.required && !hasValue(params[p.name])) {
      missing.push(p.example ? `\`${p.name}\` (e.g. "${p.example}")` : `\`${p.name}\``);
    }
  }
  for (const group of resolved.oneOfGroups) {
    if (!group.some((name) => hasValue(params[name]))) {
      missing.push(`one of ${group.map((n) => `\`${n}\``).join(", ")}`);
    }
  }
  if (missing.length > 0) {
    return {
      valid: false,
      warnings,
      error: `Missing required parameter(s) for ${route}: ${missing.join(", ")}. Run action "List endpoints" (platform "${platform}") for full parameter details.`,
    };
  }

  // ── Declared value constraints on supplied optional params ───────────
  const optionalByName = new Map(resolved.optionalParams.map((p) => [p.name, p]));
  for (const [name, value] of Object.entries(params)) {
    if (!hasValue(value)) continue;
    const spec = optionalByName.get(name);
    if (spec) {
      checkOptionalParam(spec, value, params, errors);
      continue;
    }
    const isRequired = resolved.params.some((p) => p.name === name);
    if (!isRequired && !UNIVERSAL_PARAMS.has(name)) {
      // A warning, not an error: the snapshot can lag the live registry, and a
      // stale local rule must not block a request the API would have accepted.
      warnings.push(
        `\`${name}\` is not a documented parameter of ${route}. The API rejects unknown parameters before billing, so this call may 400.`,
      );
    }
  }

  // ── Comma-separated list constraints (apply to required params too) ──
  for (const [name, constraint] of Object.entries(resolved.csvConstraints ?? {})) {
    const value = params[name];
    if (!hasValue(value)) continue;
    const entries = csvEntries(value);
    if (constraint.max !== undefined && entries.length > constraint.max) {
      errors.push(
        `\`${name}\` accepts at most ${constraint.max} comma-separated ${constraint.max === 1 ? "entry" : "entries"} — got ${entries.length}`,
      );
    }
    if (constraint.enumValues) {
      const bad = entries.filter((v) => !constraint.enumValues!.includes(v));
      if (bad.length > 0) {
        errors.push(
          `\`${name}\` entries must each be one of ${constraint.enumValues.map((v) => `"${v}"`).join(", ")} — got ${bad.map((v) => `"${v}"`).join(", ")}`,
        );
      }
    }
  }

  // ── Stateful-family ids are interpolated into the URL path ───────────
  // Restricting them to URL-safe characters stops a crafted id from steering
  // the request — including a DELETE — at a different /v1 resource.
  if (resolved.platform === "monitors" && hasValue(params.monitor_id)) {
    if (!MONITOR_ID_PATTERN.test(String(params.monitor_id))) {
      errors.push(
        `\`monitor_id\` must be 1-64 characters of letters, digits, "_" or "-" — got "${String(params.monitor_id)}". Run \`monitors/list\` to find the right id`,
      );
    }
  }

  if (resolved.platform === "cohorts") {
    for (const name of ["cohort_id", "query_id"] as const) {
      if (!hasValue(params[name])) continue;
      if (!COHORT_ID_PATTERN.test(String(params[name]))) {
        errors.push(
          `\`${name}\` must be a 21-character id or a UUID — got "${String(params[name])}". Take it from the \`create\` / \`query\` response`,
        );
      }
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      warnings,
      error: `Invalid parameter(s) for ${route}: ${errors.join("; ")}.`,
    };
  }

  return { valid: true, endpoint: resolved, warnings };
}
