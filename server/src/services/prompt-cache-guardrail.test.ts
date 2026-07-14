import { describe, expect, it } from "vitest";

import {
  classifyPromptCacheReadHealth,
  DEFAULT_PROMPT_CACHE_GUARDRAIL_OPTIONS,
} from "./prompt-cache-guardrail.js";

describe("classifyPromptCacheReadHealth", () => {
  it("reports healthy when reads dominate over an active fleet", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: 200,
      inputTokens: 1_000_000,
      cacheReadTokens: 18_000_000,
      cacheCreationTokens: 2_000_000,
    });
    expect(health.status).toBe("healthy");
    // read / (read + input)
    expect(health.readShare).toBeCloseTo(18_000_000 / 19_000_000, 5);
    // exact hit rate: read / (read + creation + input)
    expect(health.hitRate).toBeCloseTo(18_000_000 / 21_000_000, 5);
  });

  it("fires read_collapse when a leak drives read share to ~0 despite heavy input", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: 120,
      inputTokens: 15_000_000,
      cacheReadTokens: 100_000,
      cacheCreationTokens: 15_000_000,
    });
    expect(health.status).toBe("read_collapse");
    expect(health.readShare).toBeLessThan(DEFAULT_PROMPT_CACHE_GUARDRAIL_OPTIONS.readShareFloor);
    expect(health.reason).toMatch(/leaked into the cached prefix/);
  });

  it("stays quiet (insufficient_data) on an idle fleet even if read share is 0", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: 2,
      inputTokens: 1_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 500,
    });
    expect(health.status).toBe("insufficient_data");
  });

  it("stays quiet when there are enough tokens but too few runs to trust", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: 3,
      inputTokens: 5_000_000,
      cacheReadTokens: 0,
      cacheCreationTokens: 5_000_000,
    });
    expect(health.status).toBe("insufficient_data");
  });

  it("does not divide by zero when there is no traffic at all", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(health.status).toBe("insufficient_data");
    expect(health.readShare).toBeNull();
    expect(health.hitRate).toBeNull();
  });

  it("clamps negative / non-finite inputs to zero", () => {
    const health = classifyPromptCacheReadHealth({
      runsWithUsage: -5,
      inputTokens: Number.NaN,
      cacheReadTokens: -100,
      cacheCreationTokens: Number.POSITIVE_INFINITY,
    });
    expect(health.runsWithUsage).toBe(0);
    expect(health.inputTokens).toBe(0);
    expect(health.cacheReadTokens).toBe(0);
    expect(health.cacheCreationTokens).toBe(0);
    expect(health.status).toBe("insufficient_data");
  });

  it("respects overridden thresholds", () => {
    // With a low volume floor and a high read-share floor, an active fleet with
    // a modest read share should now be flagged.
    const health = classifyPromptCacheReadHealth(
      {
        runsWithUsage: 25,
        inputTokens: 800_000,
        cacheReadTokens: 200_000,
        cacheCreationTokens: 100_000,
      },
      { minObservedInputTokens: 100_000, readShareFloor: 0.5 },
    );
    expect(health.status).toBe("read_collapse");
  });
});
