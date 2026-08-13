export const GROK_DEFAULT_PERMISSION_MODE = "dontAsk";
export const GROK_PLAN_PERMISSION_MODE = "plan";
export const GROK_NO_PLAN_FLAG = "--no-plan";

const GROK_PLAN_DISABLE_FLAGS = new Set([GROK_NO_PLAN_FLAG, "--plan=false"]);

export function resolveGrokPermissionMode(raw: string | null | undefined): {
  permissionMode: string;
  remappedFromPlan: boolean;
} {
  const permissionMode = (raw ?? "").trim() || GROK_DEFAULT_PERMISSION_MODE;
  if (permissionMode.toLowerCase() === GROK_PLAN_PERMISSION_MODE) {
    return { permissionMode: GROK_DEFAULT_PERMISSION_MODE, remappedFromPlan: true };
  }
  return { permissionMode, remappedFromPlan: false };
}

export function extraArgsAlreadyDisablePlanMode(extraArgs: string[]): boolean {
  return extraArgs.some((arg) => GROK_PLAN_DISABLE_FLAGS.has(arg));
}

export function shouldDisableGrokPlanMode(input: {
  disablePlanMode?: boolean;
  extraArgs?: string[];
}): boolean {
  if (input.disablePlanMode === false) return false;
  if (extraArgsAlreadyDisablePlanMode(input.extraArgs ?? [])) return false;
  return true;
}

export function buildGrokUnattendedFlags(input: {
  permissionMode?: string | null;
  alwaysApprove?: boolean;
  disableWebSearch?: boolean;
  disablePlanMode?: boolean;
  extraArgs?: string[];
}): {
  permissionMode: string;
  remappedFromPlan: boolean;
  disablePlanMode: boolean;
  flags: string[];
} {
  const resolved = resolveGrokPermissionMode(input.permissionMode);
  const disablePlanMode = shouldDisableGrokPlanMode({
    disablePlanMode: input.disablePlanMode,
    extraArgs: input.extraArgs,
  });
  const flags: string[] = [];
  if (resolved.permissionMode) {
    flags.push("--permission-mode", resolved.permissionMode);
  }
  if (input.alwaysApprove !== false) flags.push("--always-approve");
  if (input.disableWebSearch !== false) flags.push("--disable-web-search");
  if (disablePlanMode) flags.push(GROK_NO_PLAN_FLAG);
  return {
    permissionMode: resolved.permissionMode,
    remappedFromPlan: resolved.remappedFromPlan,
    disablePlanMode,
    flags,
  };
}
