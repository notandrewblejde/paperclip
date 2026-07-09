import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  issueComments,
  issueRelations,
  issues,
} from "@paperclipai/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { issueRoutes } from "../routes/issues.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping blocked-status validation tests: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("status=blocked server-side validation", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-blocked-status-validation-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issueRelations);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp(actor: Express.Request["actor"]) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.actor = actor;
      next();
    });
    app.use("/api", issueRoutes(db, {} as any));
    app.use(errorHandler);
    return app;
  }

  function boardActor(companyId: string): Express.Request["actor"] {
    return {
      type: "board",
      userId: "board-user",
      companyIds: [companyId],
      memberships: [{ companyId, membershipRole: "admin", status: "active" }],
      isInstanceAdmin: false,
      source: "session",
    };
  }

  async function seedCompanyAndIssue(overrides: { status?: string } = {}) {
    const companyId = randomUUID();
    const issueId = randomUUID();
    const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "TestCo",
      issuePrefix,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Test Issue",
      status: overrides.status ?? "todo",
    });

    return { companyId, issueId };
  }

  async function seedBlockerIssue(companyId: string) {
    const blockerId = randomUUID();
    await db.insert(issues).values({
      id: blockerId,
      companyId,
      title: "Blocker Issue",
      status: "in_progress",
    });
    return blockerId;
  }

  describe("POST /api/companies/:companyId/issues", () => {
    it("returns 400 when status=blocked with no blockedByIssueIds", async () => {
      const companyId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      const app = createApp(boardActor(companyId));
      const res = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "New blocked issue", status: "blocked" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation error");
      expect(res.body.details[0].path).toContain("status");
    });

    it("returns 400 when status=blocked with empty blockedByIssueIds array", async () => {
      const companyId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      const app = createApp(boardActor(companyId));
      const res = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "New blocked issue", status: "blocked", blockedByIssueIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation error");
    });

    it("succeeds when status=blocked with non-empty blockedByIssueIds", async () => {
      const companyId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });
      const blockerId = await seedBlockerIssue(companyId);

      const app = createApp(boardActor(companyId));
      const res = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "New blocked issue", status: "blocked", blockedByIssueIds: [blockerId] });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("blocked");
    });

    it("allows status=todo without blockedByIssueIds", async () => {
      const companyId = randomUUID();
      const issuePrefix = `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
      await db.insert(companies).values({
        id: companyId,
        name: "TestCo",
        issuePrefix,
        requireBoardApprovalForNewAgents: false,
      });

      const app = createApp(boardActor(companyId));
      const res = await request(app)
        .post(`/api/companies/${companyId}/issues`)
        .send({ title: "Todo issue" });

      expect(res.status).toBe(200);
    });
  });

  describe("PATCH /api/issues/:id", () => {
    it("returns 400 when updating status to blocked with no blockedByIssueIds and no comment", async () => {
      const { companyId, issueId } = await seedCompanyAndIssue();
      const app = createApp(boardActor(companyId));

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({ status: "blocked" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation error");
      expect(res.body.details[0].path).toContain("status");
    });

    it("returns 400 when updating status to blocked with empty blockedByIssueIds and no comment", async () => {
      const { companyId, issueId } = await seedCompanyAndIssue();
      const app = createApp(boardActor(companyId));

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({ status: "blocked", blockedByIssueIds: [] });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation error");
    });

    it("succeeds when updating status to blocked with non-empty blockedByIssueIds", async () => {
      const { companyId, issueId } = await seedCompanyAndIssue();
      const blockerId = await seedBlockerIssue(companyId);
      const app = createApp(boardActor(companyId));

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({ status: "blocked", blockedByIssueIds: [blockerId] });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("blocked");
    });

    it("succeeds when updating status to blocked with a comment naming the unblock owner", async () => {
      const { companyId, issueId } = await seedCompanyAndIssue();
      const app = createApp(boardActor(companyId));

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({
          status: "blocked",
          comment: "Blocked waiting for CloudShell operator to redeploy. Unblock owner: AWS operator. Action: execute redeploy script.",
        });

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("blocked");
    });

    it("allows PATCH to other statuses without blockedByIssueIds", async () => {
      const { companyId, issueId } = await seedCompanyAndIssue();
      const app = createApp(boardActor(companyId));

      const res = await request(app)
        .patch(`/api/issues/${issueId}`)
        .send({ status: "in_progress" });

      expect(res.status).toBe(200);
    });
  });
});
