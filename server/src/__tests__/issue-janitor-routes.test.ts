import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const companyId = "22222222-2222-4222-8222-222222222222";
const otherCompanyId = "99999999-9999-4999-8999-999999999999";
const ownerAgentId = "33333333-3333-4333-8333-333333333333";
const ctoAgentId = "44444444-4444-4444-8444-444444444444";
const engineerAgentId = "55555555-5555-4555-8555-555555555555";
const ctoRunId = "66666666-6666-4666-8666-666666666666";

const issueAId = "10000000-0000-4000-8000-000000000001";
const issueBId = "10000000-0000-4000-8000-000000000002";
const issueCrossCompanyId = "10000000-0000-4000-8000-000000000003";

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));

const mockIssueService = vi.hoisted(() => ({
  addComment: vi.fn(),
  getById: vi.fn(),
  update: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  list: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockAccessService = vi.hoisted(() => ({
  canUser: vi.fn(),
  hasPermission: vi.fn(),
}));

const mockStorageService = vi.hoisted(() => ({
  provider: "local_disk",
  putFile: vi.fn(),
  getObject: vi.fn(),
  headObject: vi.fn(),
  deleteObject: vi.fn(),
}));

function registerRouteMocks() {
  vi.doMock("@paperclipai/shared/telemetry", () => ({
    trackAgentTaskCompleted: vi.fn(),
    trackErrorHandlerCrash: vi.fn(),
  }));

  vi.doMock("../telemetry.js", () => ({
    getTelemetryClient: vi.fn(() => ({ track: vi.fn() })),
  }));

  vi.doMock("../services/index.js", () => ({
    accessService: () => mockAccessService,
    agentService: () => mockAgentService,
    companyService: () => ({ getById: vi.fn(async () => ({ id: companyId, issuePrefix: "PAP" })) }),
    documentService: () => ({}),
    executionWorkspaceService: () => ({}),
    feedbackService: () => ({}),
    goalService: () => ({}),
    heartbeatService: () => ({
      wakeup: vi.fn(async () => undefined),
      reportRunActivity: vi.fn(async () => undefined),
      getRun: vi.fn(async () => null),
      getActiveRunForAgent: vi.fn(async () => null),
      cancelRun: vi.fn(async () => null),
    }),
    instanceSettingsService: () => ({}),
    issueApprovalService: () => ({}),
    issueReferenceService: () => ({}),
    issueService: () => mockIssueService,
    issueThreadInteractionService: () => ({}),
    logActivity: mockLogActivity,
    projectService: () => ({}),
    routineService: () => ({}),
    workProductService: () => ({}),
  }));
}

function makeIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: issueAId,
    companyId,
    status: "blocked",
    priority: "medium",
    projectId: null,
    goalId: null,
    parentId: null,
    assigneeAgentId: ownerAgentId,
    assigneeUserId: null,
    createdByUserId: "board-user",
    identifier: "PAP-100",
    title: "Stale blocked issue",
    executionPolicy: null,
    executionState: null,
    hiddenAt: null,
    ...overrides,
  };
}

function makeAgent(id: string, role: string) {
  return {
    id,
    companyId,
    role,
    reportsTo: null,
    permissions: { canCreateAgents: false },
  };
}

const activeServers: Server[] = [];

async function createApp(actor: Record<string, unknown>) {
  const [{ errorHandler }, { issueRoutes }] = await Promise.all([
    vi.importActual<typeof import("../middleware/index.js")>("../middleware/index.js"),
    vi.importActual<typeof import("../routes/issues.js")>("../routes/issues.js"),
  ]);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = actor;
    next();
  });
  app.use("/api", issueRoutes({} as any, mockStorageService as any));
  app.use(errorHandler);
  // Explicit IPv4 bind: some sandboxes lack IPv6 loopback (::1), and
  // supertest(app) uses Node's default which can prefer IPv6.
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  activeServers.push(server);
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function ctoActor() {
  return {
    type: "agent",
    agentId: ctoAgentId,
    companyId,
    source: "agent_key",
    runId: ctoRunId,
  };
}

function engineerActor() {
  return {
    type: "agent",
    agentId: engineerAgentId,
    companyId,
    source: "agent_key",
    runId: "engineer-run",
  };
}

function boardActor() {
  return {
    type: "board",
    userId: "board-user",
    companyIds: [companyId],
    memberships: [{ companyId, membershipRole: "owner", status: "active" }],
    isInstanceAdmin: false,
    source: "session",
  };
}

describe("issue janitor endpoint", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@paperclipai/shared/telemetry");
    vi.doUnmock("../telemetry.js");
    vi.doUnmock("../services/index.js");
    vi.doUnmock("../routes/issues.js");
    vi.doUnmock("../routes/authz.js");
    vi.doUnmock("../middleware/index.js");
    registerRouteMocks();
    vi.clearAllMocks();

    mockAgentService.getById.mockImplementation(async (id: string) => {
      if (id === ctoAgentId) return makeAgent(ctoAgentId, "cto");
      if (id === engineerAgentId) return makeAgent(engineerAgentId, "engineer");
      if (id === ownerAgentId) return makeAgent(ownerAgentId, "engineer");
      return null;
    });
    mockAgentService.list.mockResolvedValue([]);
    mockAgentService.resolveByReference.mockResolvedValue({ ambiguous: false, agent: null });
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.hasPermission.mockResolvedValue(false);

    mockIssueService.getById.mockImplementation(async (id: string) => {
      if (id === issueAId) return makeIssue({ id: issueAId, identifier: "PAP-100" });
      if (id === issueBId)
        return makeIssue({ id: issueBId, identifier: "PAP-101", title: "Second stale" });
      if (id === issueCrossCompanyId)
        return makeIssue({ id: issueCrossCompanyId, companyId: otherCompanyId, identifier: "PAP-200" });
      return null;
    });
    mockIssueService.update.mockImplementation(async (id: string, patch: Record<string, unknown>) => ({
      ...makeIssue({ id }),
      ...patch,
    }));
    mockIssueService.addComment.mockResolvedValue({
      id: "comment-1",
      issueId: issueAId,
      companyId,
      body: "janitor comment",
    });
  });

  afterEach(async () => {
    while (activeServers.length > 0) {
      const s = activeServers.pop();
      if (!s) continue;
      await new Promise<void>((resolve) => s.close(() => resolve()));
    }
  });

  it("allows a cto agent to flip another agent's blocked issue and writes audit", async () => {
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "SPC-9376 janitor pass",
        actions: [
          { issueId: issueAId, status: "todo", comment: "Cleared zero-blocker stale" },
          { issueId: issueBId, status: "done" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(false);
    expect(res.body.summary).toMatchObject({ applied: 2, denied: 0, skipped: 0, would_apply: 0 });
    expect(res.body.actions).toHaveLength(2);
    expect(res.body.actions[0]).toMatchObject({
      issueId: issueAId,
      outcome: "applied",
      priorStatus: "blocked",
      priorAssigneeAgentId: ownerAgentId,
      nextStatus: "todo",
      commentId: "comment-1",
    });
    expect(res.body.actions[1]).toMatchObject({
      issueId: issueBId,
      outcome: "applied",
      priorStatus: "blocked",
      nextStatus: "done",
    });
    expect(mockIssueService.update).toHaveBeenCalledTimes(2);
    expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
    expect(mockLogActivity).toHaveBeenCalledTimes(2);
    const firstLogCall = mockLogActivity.mock.calls[0]?.[1] as any;
    expect(firstLogCall.action).toBe("issue.janitor_flip");
    expect(firstLogCall.entityId).toBe(issueAId);
    expect(firstLogCall.details).toMatchObject({
      reason: "SPC-9376 janitor pass",
      priorStatus: "blocked",
      priorAssigneeAgentId: ownerAgentId,
      nextStatus: "todo",
      statusChanged: true,
      commentPosted: true,
    });
    expect(firstLogCall.runId).toBe(ctoRunId);
  });

  it("rejects an engineer agent with 403", async () => {
    const { url } = await createApp(engineerActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "test",
        actions: [{ issueId: issueAId, status: "todo" }],
      });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/cto or ceo role/i);
    expect(mockIssueService.update).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("allows a board user to flip and audits actor as user", async () => {
    const { url } = await createApp(boardActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "board cleanup",
        actions: [{ issueId: issueAId, status: "todo" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.actions[0]).toMatchObject({ outcome: "applied", nextStatus: "todo" });
    const call = mockLogActivity.mock.calls[0]?.[1] as any;
    expect(call.actorType).toBe("user");
    expect(call.actorId).toBe("board-user");
  });

  it("dryRun returns would_apply without mutating", async () => {
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "preview",
        dryRun: true,
        actions: [
          { issueId: issueAId, status: "todo" },
          { issueId: issueBId, status: "done", comment: "would close" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.summary).toMatchObject({ would_apply: 2, applied: 0 });
    expect(res.body.actions[0]).toMatchObject({
      outcome: "would_apply",
      priorStatus: "blocked",
      nextStatus: "todo",
    });
    expect(mockIssueService.update).not.toHaveBeenCalled();
    expect(mockIssueService.addComment).not.toHaveBeenCalled();
    expect(mockLogActivity).not.toHaveBeenCalled();
  });

  it("denies cross-company issues and continues with the rest", async () => {
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "mixed",
        actions: [
          { issueId: issueAId, status: "todo" },
          { issueId: issueCrossCompanyId, status: "todo" },
          { issueId: "10000000-0000-4000-8000-00000000ffff", status: "todo" },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ applied: 1, denied: 1, skipped: 1 });
    expect(res.body.actions[1]).toMatchObject({ outcome: "denied", denyReason: "cross_company" });
    expect(res.body.actions[2]).toMatchObject({ outcome: "skipped", denyReason: "not_found" });
  });

  it("rejects payload exceeding 500 actions", async () => {
    const { url } = await createApp(ctoActor());
    const actions = Array.from({ length: 501 }, (_, i) => ({
      issueId: `10000000-0000-4000-8000-000000000${(i + 100).toString().padStart(3, "0")}`,
      status: "todo" as const,
    }));
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({ reason: "too big", actions });
    expect(res.status).toBe(400);
  });

  it("rejects missing reason", async () => {
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({ actions: [{ issueId: issueAId, status: "todo" }] });
    expect(res.status).toBe(400);
  });

  it("rejects an action that mutates nothing", async () => {
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({ reason: "empty", actions: [{ issueId: issueAId }] });
    expect(res.status).toBe(400);
  });

  it("records an error outcome when svc.update throws", async () => {
    mockIssueService.update.mockImplementationOnce(async () => {
      throw new Error("unprocessable: blocked by unresolved blockers");
    });
    const { url } = await createApp(ctoActor());
    const res = await request(url)
      .post(`/api/companies/${companyId}/issues/janitor`)
      .send({
        reason: "test failure path",
        actions: [{ issueId: issueAId, status: "todo" }],
      });
    expect(res.status).toBe(200);
    expect(res.body.actions[0]).toMatchObject({
      outcome: "denied",
      denyReason: "update_failed",
      error: expect.stringContaining("unresolved blockers"),
    });
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
