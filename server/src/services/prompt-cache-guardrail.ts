// Zero-read guardrail for Anthropic prompt caching (SPC-22537).
//
// The SPC-22535 audit confirmed prompt caching is enabled and correctly
// configured, saving on the order of $10^5+/yr in prefix reprocessing. The one
// silent failure mode that would quietly destroy that saving is a volatile
// value (timestamp, UUID, ...) leaking into the cached prefix: every request
// then misses the cache, `cache_read_input_tokens` collapses toward zero, and
// the only symptom is a cost increase with no error anywhere.
//
// This module is the *decision layer* of the guardrail: a pure, side-effect
// free classifier over fleet-wide token aggregates. The heartbeat service runs
// the aggregate query, feeds it here, and emits a critical log event on
// `read_collapse`. Keeping the logic pure makes the thresholds and hysteresis
// unit-testable without a database.

export interface FleetPromptCacheStats {
  /** Number of finished runs in the window that reported usage. */
  runsWithUsage: number;
  /** Sum of non-cached prompt input tokens across the window. */
  inputTokens: number;
  /** Sum of prompt-cache read (hit) tokens across the window. */
  cacheReadTokens: number;
  /** Sum of prompt-cache creation (write) tokens across the window. */
  cacheCreationTokens: number;
}

export interface PromptCacheGuardrailOptions {
  /** Minimum finished-with-usage runs before the signal is trusted. */
  minRunsWithUsage: number;
  /** Minimum (input + cacheRead) tokens before the signal is trusted. */
  minObservedInputTokens: number;
  /** Read share below which the cache is treated as collapsed. */
  readShareFloor: number;
}

// Defaults are deliberately conservative so the guardrail only fires on a
// genuine fleet-wide collapse, never on an idle window or a single cold
// heartbeat. Healthy steady-state read share is ~0.85-0.95; a real prefix leak
// drives it toward 0 across *every* run in the window, so a 0.20 floor leaves a
// wide margin. The volume floors (~20 runs, ~500k observed input tokens)
// suppress false alarms when the fleet is quiet.
export const DEFAULT_PROMPT_CACHE_GUARDRAIL_OPTIONS: PromptCacheGuardrailOptions = {
  minRunsWithUsage: 20,
  minObservedInputTokens: 500_000,
  readShareFloor: 0.2,
};

export type PromptCacheReadHealthStatus = "healthy" | "read_collapse" | "insufficient_data";

export interface PromptCacheReadHealth {
  status: PromptCacheReadHealthStatus;
  /** cacheRead / (cacheRead + input); null when the denominator is 0. */
  readShare: number | null;
  /** Exact hit rate: read / (read + creation + input); null when denom is 0. */
  hitRate: number | null;
  runsWithUsage: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reason: string;
}

function nonNegInt(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

/**
 * Classify fleet-wide prompt-cache read health.
 *
 * - `insufficient_data`: not enough runs / traffic in the window to trust the
 *   signal (fleet idle or warming up) — never alarm.
 * - `read_collapse`: substantial input traffic but the read share has fallen
 *   below the floor — a volatile value has almost certainly leaked into the
 *   cached prefix. This is the alarm condition.
 * - `healthy`: reads dominate as expected.
 */
export function classifyPromptCacheReadHealth(
  stats: FleetPromptCacheStats,
  options: Partial<PromptCacheGuardrailOptions> = {},
): PromptCacheReadHealth {
  const opts = { ...DEFAULT_PROMPT_CACHE_GUARDRAIL_OPTIONS, ...options };
  const runsWithUsage = nonNegInt(stats.runsWithUsage);
  const inputTokens = nonNegInt(stats.inputTokens);
  const cacheReadTokens = nonNegInt(stats.cacheReadTokens);
  const cacheCreationTokens = nonNegInt(stats.cacheCreationTokens);

  const readPlusInput = cacheReadTokens + inputTokens;
  const readShare = readPlusInput > 0 ? cacheReadTokens / readPlusInput : null;
  const hitDenom = cacheReadTokens + cacheCreationTokens + inputTokens;
  const hitRate = hitDenom > 0 ? cacheReadTokens / hitDenom : null;

  const base = {
    readShare,
    hitRate,
    runsWithUsage,
    inputTokens,
    cacheReadTokens,
    cacheCreationTokens,
  } satisfies Omit<PromptCacheReadHealth, "status" | "reason">;

  if (runsWithUsage < opts.minRunsWithUsage || readPlusInput < opts.minObservedInputTokens) {
    return {
      ...base,
      status: "insufficient_data",
      reason:
        `insufficient signal: runsWithUsage=${runsWithUsage} (min ${opts.minRunsWithUsage}), ` +
        `observedInput=${readPlusInput} (min ${opts.minObservedInputTokens})`,
    };
  }

  if (readShare !== null && readShare < opts.readShareFloor) {
    return {
      ...base,
      status: "read_collapse",
      reason:
        `prompt-cache read share ${(readShare * 100).toFixed(1)}% is below the ${(opts.readShareFloor * 100).toFixed(0)}% ` +
        `floor over ${runsWithUsage} runs — a volatile value likely leaked into the cached prefix, ` +
        `dropping the hit rate and silently increasing cost`,
    };
  }

  return {
    ...base,
    status: "healthy",
    reason: `prompt-cache read share ${readShare !== null ? `${(readShare * 100).toFixed(1)}%` : "n/a"} is healthy`,
  };
}
