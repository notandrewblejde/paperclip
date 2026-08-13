import { describe, expect, it } from "vitest";
import {
  GROK_DEFAULT_PERMISSION_MODE,
  GROK_NO_PLAN_FLAG,
  buildGrokUnattendedFlags,
  resolveGrokPermissionMode,
  shouldDisableGrokPlanMode,
} from "./cli-flags.js";

describe("resolveGrokPermissionMode", () => {
  it("defaults to dontAsk", () => {
    expect(resolveGrokPermissionMode("")).toEqual({
      permissionMode: GROK_DEFAULT_PERMISSION_MODE,
      remappedFromPlan: false,
    });
  });

  it("remaps Grok CLI plan permission mode so heartbeats can execute tools", () => {
    expect(resolveGrokPermissionMode("plan")).toEqual({
      permissionMode: GROK_DEFAULT_PERMISSION_MODE,
      remappedFromPlan: true,
    });
    expect(resolveGrokPermissionMode("PLAN")).toEqual({
      permissionMode: GROK_DEFAULT_PERMISSION_MODE,
      remappedFromPlan: true,
    });
  });

  it("preserves explicit unattended permission modes", () => {
    expect(resolveGrokPermissionMode("bypassPermissions")).toEqual({
      permissionMode: "bypassPermissions",
      remappedFromPlan: false,
    });
  });
});

describe("shouldDisableGrokPlanMode", () => {
  it("defaults to disabling Grok plan mode", () => {
    expect(shouldDisableGrokPlanMode({})).toBe(true);
  });

  it("honors an explicit opt-out", () => {
    expect(shouldDisableGrokPlanMode({ disablePlanMode: false })).toBe(false);
  });

  it("does not duplicate --no-plan when extraArgs already disable plan mode", () => {
    expect(shouldDisableGrokPlanMode({ extraArgs: [GROK_NO_PLAN_FLAG] })).toBe(false);
  });
});

describe("buildGrokUnattendedFlags", () => {
  it("emits --no-plan and never passes permission-mode plan", () => {
    const built = buildGrokUnattendedFlags({ permissionMode: "plan" });
    expect(built.permissionMode).toBe(GROK_DEFAULT_PERMISSION_MODE);
    expect(built.remappedFromPlan).toBe(true);
    expect(built.disablePlanMode).toBe(true);
    expect(built.flags).toEqual([
      "--permission-mode",
      GROK_DEFAULT_PERMISSION_MODE,
      "--always-approve",
      "--disable-web-search",
      GROK_NO_PLAN_FLAG,
    ]);
    expect(built.flags).not.toContain("plan");
  });
});
