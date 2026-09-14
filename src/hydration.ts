import type { Endpoint, HydrationJoin, OptionalParam } from "./types.js";

/**
 * Row hydration — the `include=…` joins.
 *
 * A growing part of the surface accepts an `include` token that makes ONE call
 * do the work of many: the endpoint runs its normal read, then reads a sibling
 * endpoint for the rows it got back and folds the result onto each one —
 * subscriber counts onto a video list, exact follower counts onto a people
 * search, save counts onto a pin, the engagement block onto rows that ship
 * without one.
 *
 * This matters here for one reason above all: it moves the price. A joined call
 * holds a per-row ceiling up front and keeps only the rows it actually filled —
 * rows served from the sibling's own cache, and rows it could not fill, are
 * refunded. So the same endpoint costs its flat base on a plain call and up to
 * its metered ceiling with a join on, and nothing in the plain `credit_cost`
 * number tells you that.
 *
 * Since 2026-09-14 the registry DECLARES all of this per token (`hydration`):
 * the sibling, the exact leaves filled, the per-row rate, the row cap, the
 * param that lowers the cap, the batch cap where the sibling takes a batch, and
 * the warning codes. Everything below reads that declaration. Nothing infers.
 *
 * What that replaced is worth stating, because it was wrong in two ways. The
 * Actor used to spot a join by "has an enum `include` AND meters above its base
 * cost", and price it at `maxCost - cost`. That classed `reddit/omni-search`
 * (which meters per thread expanded, not per row joined) as a join, and on the
 * four endpoints that meter for reasons BESIDES the join it attributed the
 * whole band to the join — quoting `threads/user/posts` at 164 extra credits
 * when its join tops out at 15.
 *
 * The same `include` param name still carries a SECOND, unrelated meaning on
 * the composites and the one-call dossiers, where it is a free-form CSV that
 * picks which response blocks to build. Those simply have no `hydration` entry,
 * and are reported as `section-select` so they are neither hidden nor priced as
 * something they are not.
 */

/** Params that can carry a join. `include_details` is a legacy boolean alias. */
const JOIN_PARAMS = ["include", "include_details"] as const;

export type JoinKind =
  /** Reads a sibling endpoint for the rows returned and bills for what it filled. */
  | "row-join"
  /** Picks which blocks of the response to build. May still move the price. */
  | "section-select";

export interface IncludeJoin {
  /** The param that carries it. */
  param: string;
  kind: JoinKind;
  /** Declared token vocabulary, or `null` when the param is free-form CSV. */
  tokens: string[] | null;
  /** How many comma-separated tokens the endpoint accepts. */
  maxTokens: number;
  /** Whether the join fills every row of a list, or the one object returned. */
  appliesTo: "each row" | "the response";
  /**
   * Ceiling on the EXTRA credits this join can add over the plain call, summed
   * across its tokens. `0` where the token only reshapes the response.
   */
  extraCreditsMax: number;
  /** The registry's own wording for what this fills in and what it costs. */
  description: string;
  /** A legacy spelling kept working; prefer the canonical `include` token. */
  alias: boolean;
  /** The per-token declarations behind this param, empty for a section select. */
  declared: HydrationJoin[];
}

/** What one declared token can add to a call that does not cap its rows. */
export function tokenCeiling(h: HydrationJoin): number {
  if (h.batch) return h.batch.creditCap;
  return h.maxItems * h.creditsPerItem;
}

/**
 * What one declared token adds to THIS call, given its params.
 *
 * Two levers lower it below the headline ceiling, and both are declared:
 * `rowLimitParam` (the caller asked for fewer rows than the join would fill)
 * and `defaultRowLimit` (the endpoint joins fewer rows when no limit is sent —
 * `instagram/similar` joins its top 20 by default, not all 80).
 */
export function tokenCeilingForCall(
  h: HydrationJoin,
  params: Record<string, unknown>,
): number {
  // A batch bills a flat cap for the whole call, so a row limit cannot lower it.
  if (h.batch) return h.batch.creditCap;

  let rows = h.maxItems;
  if (h.defaultRowLimit !== undefined) rows = h.defaultRowLimit;
  if (h.rowLimitParam) {
    const asked = Number(params[h.rowLimitParam]);
    if (Number.isFinite(asked) && asked >= 1) {
      rows = Math.min(Math.floor(asked), h.maxItems);
    }
  }
  return rows * h.creditsPerItem;
}

/** The token vocabulary an endpoint declares for a join param, if any. */
function tokenVocabulary(e: Endpoint, spec: OptionalParam): string[] | null {
  if (spec.enumValues?.length) return spec.enumValues;
  const csv = e.csvConstraints?.[spec.name];
  if (csv?.enumValues?.length) return csv.enumValues;
  return null;
}

function maxTokensFor(e: Endpoint, spec: OptionalParam): number {
  const csv = e.csvConstraints?.[spec.name];
  if (csv?.max !== undefined) return csv.max;
  // An enum param takes exactly one token; a free-form CSV has no declared cap.
  return spec.type === "enum" ? 1 : (tokenVocabulary(e, spec)?.length ?? 1);
}

/**
 * Every join an endpoint offers, in the order the registry declares them.
 *
 * A param is a `row-join` when the registry carries `hydration` entries for it
 * — that is the whole test. Anything else with an `include` is a
 * `section-select`.
 */
export function includeJoins(e: Endpoint): IncludeJoin[] {
  const names = new Set(e.optionalParams.map((p) => p.name));
  const joins: IncludeJoin[] = [];

  for (const name of JOIN_PARAMS) {
    const spec = e.optionalParams.find((p) => p.name === name);
    if (!spec) continue;

    const declared = (e.hydration ?? []).filter((h) => h.param === name);
    // The legacy boolean alias runs the canonical token's join at the same
    // price, so it inherits that token's declaration rather than having none.
    const inherited =
      declared.length === 0 && name === "include_details" && names.has("include")
        ? (e.hydration ?? []).filter((h) => h.param === "include")
        : [];
    const effective = declared.length > 0 ? declared : inherited;

    joins.push({
      param: name,
      kind: effective.length > 0 ? "row-join" : "section-select",
      tokens: tokenVocabulary(e, spec),
      maxTokens: maxTokensFor(e, spec),
      appliesTo: e.responseShape?.root.endsWith("items[]")
        ? "each row"
        : "the response",
      extraCreditsMax: effective.reduce((n, h) => n + tokenCeiling(h), 0),
      description: spec.description ?? "",
      alias: name === "include_details" && names.has("include"),
      declared: effective,
    });
  }

  return joins;
}

/** True when this endpoint can read a sibling to fill what it returns. */
export function hasRowJoin(e: Endpoint): boolean {
  return (e.hydration?.length ?? 0) > 0;
}

/** The join tokens a set of request params actually asks for. */
export function requestedJoinTokens(
  params: Record<string, unknown>,
): { param: string; tokens: string[] }[] {
  const asked: { param: string; tokens: string[] }[] = [];
  for (const name of JOIN_PARAMS) {
    const value = params[name];
    if (value === undefined || value === null || value === "") continue;
    // `include_details` is a boolean alias — `true` asks for the join, `false`
    // is the plain call and must not be priced as one.
    if (typeof value === "boolean") {
      if (value) asked.push({ param: name, tokens: [] });
      continue;
    }
    const tokens = String(value)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) continue;
    // The same thing arriving as a string through a JSON form field.
    if (tokens.length === 1 && /^(false|0|no)$/i.test(tokens[0] ?? "")) continue;
    asked.push({ param: name, tokens });
  }
  return asked;
}

/**
 * The declared joins a concrete request actually turns on.
 *
 * A token the caller did not name is not billed, which is why this resolves to
 * individual declarations rather than to the endpoint's whole ceiling:
 * `include=engagement` on a YouTube list buys the engagement join alone, and
 * quoting the `channel` join alongside it would overstate the call by half.
 * The boolean alias names no token, so it turns on everything its param covers.
 */
export function activeJoins(
  e: Endpoint,
  params: Record<string, unknown>,
): HydrationJoin[] {
  const asked = requestedJoinTokens(params);
  if (asked.length === 0) return [];

  const active: HydrationJoin[] = [];
  for (const join of includeJoins(e)) {
    const match = asked.find((a) => a.param === join.param);
    if (!match) continue;
    for (const h of join.declared) {
      if (match.tokens.length === 0 || match.tokens.includes(h.token)) {
        if (!active.includes(h)) active.push(h);
      }
    }
  }
  return active;
}

export interface JoinCostImpact {
  /** True when the params in hand actually turn a billed join on. */
  requested: boolean;
  /** Tokens asked for, flattened across `include` and its alias. */
  tokens: string[];
  /** Extra credits these joins can add to this call. */
  extraCreditsMax: number;
  /** One line naming what the join does to the bill, or null when it cannot. */
  note: string | null;
}

/**
 * What the joins in a concrete set of params do to this call's price.
 *
 * This is the difference between "1-26 credits, who knows" and "you asked for
 * `include=engagement` with `limit=10`, so this page can cost 11". It is what
 * the dry run and the pre-flight estimate quote.
 */
export function joinCostImpact(
  e: Endpoint,
  params: Record<string, unknown>,
): JoinCostImpact {
  const tokens = requestedJoinTokens(params).flatMap((a) => a.tokens);
  const active = activeJoins(e, params);
  if (active.length === 0) {
    return { requested: false, tokens, extraCreditsMax: 0, note: null };
  }

  const extraCreditsMax = active.reduce(
    (n, h) => n + tokenCeilingForCall(h, params),
    0,
  );
  const headline = active.reduce((n, h) => n + tokenCeiling(h), 0);
  const named = active.map((h) => `\`${h.token}\``).join(" and ");
  const rowWord =
    e.responseShape?.root.endsWith("items[]") === true ? "row" : "field";

  // Say WHY the number came down, or the reader cannot check it.
  let why = "";
  if (extraCreditsMax < headline) {
    const capped = active.find(
      (h) => h.rowLimitParam !== undefined && params[h.rowLimitParam] !== undefined,
    );
    why = capped
      ? ` \`${capped.rowLimitParam}=${String(params[capped.rowLimitParam!])}\` caps it here: at full width the ceiling is ${headline}.`
      : ` The join fills its default row count here; at full width the ceiling is ${headline}.`;
  }

  return {
    requested: true,
    tokens,
    extraCreditsMax,
    note:
      `This call asks for ${named}, so it is priced with the join on: up to ` +
      `${extraCreditsMax} extra credit${extraCreditsMax === 1 ? "" : "s"} over the plain ` +
      `read, held up front and refunded for every ${rowWord} that came from cache or ` +
      `could not be filled.${why}`,
  };
}

/**
 * The join catalogue for one endpoint, shaped for a dataset row. `null` when
 * the endpoint offers none, so the key stays off rows it does not apply to.
 */
export function describeJoins(e: Endpoint): Record<string, unknown>[] | null {
  const joins = includeJoins(e);
  if (joins.length === 0) return null;
  return joins.map((j) => ({
    param: j.param,
    kind: j.kind,
    allowed_values: j.tokens,
    max_values: j.maxTokens,
    applies_to: j.appliesTo,
    extra_credits_max: j.extraCreditsMax,
    ...(j.alias ? { legacy_alias: true } : {}),
    description: j.description,
    // Per token: what it fills, what it costs, and how it can be capped. This
    // is the part that lets someone decide whether a join is worth its credits
    // without making the call first.
    ...(j.declared.length > 0
      ? {
          tokens: j.declared.map((h) => ({
            token: h.token,
            fills: h.fills,
            ...(h.replaceApproximate
              ? { replaces_approximate: h.replaceApproximate }
              : {}),
            filled_by: `/v1/${h.sibling}`,
            ...(h.siblingMethod ? { filled_by_method: h.siblingMethod } : {}),
            credits_per_item: h.creditsPerItem,
            max_items: h.maxItems,
            ...(h.defaultRowLimit !== undefined
              ? { default_rows_joined: h.defaultRowLimit }
              : {}),
            ...(h.rowLimitParam ? { row_limit_param: h.rowLimitParam } : {}),
            ...(h.batch
              ? { batched: { size: h.batch.size, credit_cap: h.batch.creditCap } }
              : {}),
            extra_credits_max: tokenCeiling(h),
            cached_rows_are_free: h.cacheSibling === true,
            ...(h.warnings ? { warning_codes: h.warnings } : {}),
          })),
        }
      : {}),
  }));
}
