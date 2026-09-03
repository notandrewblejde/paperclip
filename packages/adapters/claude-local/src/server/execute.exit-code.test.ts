import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { runChildProcess, ensureCommandResolvable, resolveCommandForLogs } = vi.hoisted(() => ({
  runChildProcess: vi.fn(),
  ensureCommandResolvable: vi.fn(async () => undefined),
  resolveCommandForLogs: vi.fn(async () => "/usr/local/bin/claude"),
}));

vi.mock("@paperclipai/adapter-utils/server-utils", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/adapter-utils/server-utils")>(
    "@paperclipai/adapter-utils/server-utils",
  );
  return {
    ...actual,
    ensureCommandResolvable,
    resolveCommandForLogs,
    runChildProcess,
  };
});

import { execute } from "./execute.js";

function claudeStdout(finalResult: Record<string, unknown>): string {
  return [
    JSON.stringify({ type: "system", subtype: "init", session_id: "claude-session-1", model: "claude-sonnet" }),
    JSON.stringify({
      type: "assistant",
      session_id: "claude-session-1",
      message: { content: [{ type: "text", text: "Heartbeat complete." }] },
    }),
    JSON.stringify({ type: "result", session_id: "claude-session-1", ...finalResult }),
  ].join("\n");
}

function processResult(exitCode: number | null, stdout: string, signal: string | null = null) {
  return {
    exitCode,
    signal,
    timedOut: false,
    stdout,
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  };
}

async function executeWithProcessResult(proc: ReturnType<typeof processResult>, cwd: string) {
  runChildProcess.mockResolvedValueOnce(proc);
  return await execute({
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "company-1",
      name: "Claude Coder",
      adapterType: "claude_local",
      adapterConfig: {},
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: null,
    },
    config: {
      command: "claude",
      cwd,
      env: {},
    },
    context: {},
    onLog: async () => {},
  });
}

describe("claude run outcome classification vs process exit code", () => {
  const cleanupDirs: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    while (cleanupDirs.length > 0) {
      const dir = cleanupDirs.pop();
      if (!dir) continue;
      await rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  // Regression: SPC-37095. When the run ends while background tasks / MCP
  // teardown are still draining, the terminal-result cleanup SIGTERMs the CLI
  // and it exits non-zero AFTER already reporting subtype=success. That run
  // succeeded; reporting it as failed feeds terminal-run recovery a phantom
  // `adapter_failed` and strands healthy issues on the recovery owner.
  it("keeps a subtype=success result successful when the process is reaped non-zero after the result", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-exit-"));
    cleanupDirs.push(cwd);
    const result = await executeWithProcessResult(
      processResult(
        143,
        claudeStdout({
          subtype: "success",
          is_error: false,
          result: "Heartbeat complete. All lanes healthy.",
          total_cost_usd: 0.1,
          usage: { input_tokens: 10, cache_read_input_tokens: 0, output_tokens: 5 },
        }),
      ),
      cwd,
    );

    expect(result.errorMessage).toBeNull();
    expect(result.errorCode).toBeNull();
    // The server re-derives outcome from exitCode independently of
    // errorMessage, so the adapter must normalize it for successful runs.
    expect(result.exitCode).toBe(0);
    expect(result.summary).toBe("Heartbeat complete. All lanes healthy.");
    // Raw teardown exit info stays visible for forensics.
    expect(result.resultJson).toMatchObject({ processExitCode: 143 });
  });

  it("still fails a non-zero exit when the result reports an error", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-exit-"));
    cleanupDirs.push(cwd);
    const result = await executeWithProcessResult(
      processResult(
        1,
        claudeStdout({
          subtype: "error_during_execution",
          is_error: true,
          result: "something broke",
        }),
      ),
      cwd,
    );

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).toContain("Claude run failed");
  });

  it("still fails an is_error result even when the process exits zero", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-exit-"));
    cleanupDirs.push(cwd);
    const result = await executeWithProcessResult(
      processResult(
        0,
        claudeStdout({
          subtype: "success",
          is_error: true,
          result: "reported error",
        }),
      ),
      cwd,
    );

    expect(result.errorMessage).toContain("Claude run failed");
  });

  it("still fails a non-zero exit with no terminal result", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "paperclip-claude-exit-"));
    cleanupDirs.push(cwd);
    const result = await executeWithProcessResult(processResult(1, "boom", null), cwd);

    expect(result.exitCode).toBe(1);
    expect(result.errorMessage).not.toBeNull();
  });
});
