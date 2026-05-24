export { claudeSessionCwdMatchesExecutionTarget, execute, runClaudeLogin } from "./execute.js";
export { listClaudeSkills, syncClaudeSkills } from "./skills.js";
export { listClaudeModels } from "./models.js";
export { testEnvironment } from "./test.js";
export {
  parseClaudeStreamJson,
  describeClaudeFailure,
  isClaudeMaxTurnsResult,
  isClaudeUnknownSessionError,
} from "./parse.js";
import { parseClaudeStreamJson } from "./parse.js";

/**
 * Recover aggregated usage from a partial Claude stream-json stdout buffer.
 * Used by the harness when the heartbeat child is SIGKILL-ed before the
 * terminal `result` frame is emitted, so the per-turn `assistant` usage
 * already streamed can be flushed to the run row's `usageJson` (SPC-6119).
 */
export function recoverPartialUsage(stdout: string): {
  usage: { inputTokens: number; outputTokens: number; cachedInputTokens?: number } | null;
  partialUsageMessages: number;
  model: string | null;
} | null {
  if (!stdout) return null;
  const parsed = parseClaudeStreamJson(stdout);
  if (!parsed.usagePartial || !parsed.usage) {
    return { usage: null, partialUsageMessages: 0, model: parsed.model || null };
  }
  return {
    usage: parsed.usage,
    partialUsageMessages: parsed.partialUsageMessages,
    model: parsed.model || null,
  };
}
export {
  getQuotaWindows,
  readClaudeAuthStatus,
  readClaudeToken,
  fetchClaudeQuota,
  fetchClaudeCliQuota,
  captureClaudeCliUsageText,
  parseClaudeCliUsageText,
  toPercent,
  fetchWithTimeout,
  claudeConfigDir,
} from "./quota.js";
import type { AdapterSessionCodec } from "@paperclipai/adapter-utils";

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw: unknown) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const record = raw as Record<string, unknown>;
    const sessionId = readNonEmptyString(record.sessionId) ?? readNonEmptyString(record.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(record.cwd) ??
      readNonEmptyString(record.workdir) ??
      readNonEmptyString(record.folder);
    const promptBundleKey =
      readNonEmptyString(record.promptBundleKey) ??
      readNonEmptyString(record.prompt_bundle_key);
    const workspaceId = readNonEmptyString(record.workspaceId) ?? readNonEmptyString(record.workspace_id);
    const repoUrl = readNonEmptyString(record.repoUrl) ?? readNonEmptyString(record.repo_url);
    const repoRef = readNonEmptyString(record.repoRef) ?? readNonEmptyString(record.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(promptBundleKey ? { promptBundleKey } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  serialize(params: Record<string, unknown> | null) {
    if (!params) return null;
    const sessionId = readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
    if (!sessionId) return null;
    const cwd =
      readNonEmptyString(params.cwd) ??
      readNonEmptyString(params.workdir) ??
      readNonEmptyString(params.folder);
    const promptBundleKey =
      readNonEmptyString(params.promptBundleKey) ??
      readNonEmptyString(params.prompt_bundle_key);
    const workspaceId = readNonEmptyString(params.workspaceId) ?? readNonEmptyString(params.workspace_id);
    const repoUrl = readNonEmptyString(params.repoUrl) ?? readNonEmptyString(params.repo_url);
    const repoRef = readNonEmptyString(params.repoRef) ?? readNonEmptyString(params.repo_ref);
    return {
      sessionId,
      ...(cwd ? { cwd } : {}),
      ...(promptBundleKey ? { promptBundleKey } : {}),
      ...(workspaceId ? { workspaceId } : {}),
      ...(repoUrl ? { repoUrl } : {}),
      ...(repoRef ? { repoRef } : {}),
    };
  },
  getDisplayId(params: Record<string, unknown> | null) {
    if (!params) return null;
    return readNonEmptyString(params.sessionId) ?? readNonEmptyString(params.session_id);
  },
};
