import { describe, expect, it } from "vitest";
import {
  allowsIssueInteractionWake,
  isResolvedInteractionContinuationWake,
  shouldQueueFollowupForRunningIssueWake,
} from "../services/heartbeat.js";

// SPC-30159 incident 2: an ask_user_questions interaction with
// continuationPolicy wake_assignee was answered by the board, but the
// continuation wake was terminally skipped by the dependency-blocked gate
// (reason "issue_commented" with no comment id fails the tree-control check),
// and would have been silently coalesced into a running session otherwise.
// These tests pin the resolved-interaction continuation wake as deliverable.

function resolvedInteractionContext(overrides: Record<string, unknown> = {}) {
  return {
    issueId: "issue-1",
    taskId: "issue-1",
    interactionId: "interaction-1",
    interactionKind: "ask_user_questions",
    interactionStatus: "answered",
    sourceCommentId: null,
    sourceRunId: "run-1",
    wakeReason: "issue_commented",
    source: "issue.interaction.responded",
    ...overrides,
  };
}

describe("isResolvedInteractionContinuationWake", () => {
  it("matches resolved interaction continuation wakes for every resolving status", () => {
    for (const interactionStatus of ["answered", "accepted", "rejected", "cancelled"]) {
      expect(
        isResolvedInteractionContinuationWake(resolvedInteractionContext({ interactionStatus })),
        interactionStatus,
      ).toBe(true);
    }
  });

  it("does not match pending or expired interactions, or non-interaction wakes", () => {
    expect(isResolvedInteractionContinuationWake(resolvedInteractionContext({ interactionStatus: "pending" }))).toBe(false);
    expect(isResolvedInteractionContinuationWake(resolvedInteractionContext({ interactionStatus: "expired" }))).toBe(false);
    expect(isResolvedInteractionContinuationWake(resolvedInteractionContext({ interactionId: null }))).toBe(false);
    expect(isResolvedInteractionContinuationWake({ issueId: "issue-1", wakeReason: "issue_commented" })).toBe(false);
    expect(isResolvedInteractionContinuationWake(null)).toBe(false);
  });
});

describe("allowsIssueInteractionWake", () => {
  it("allows a resolved interaction continuation wake through the dependency-blocked gate without a comment id", () => {
    // The incident wake: reason issue_commented, no commentId anywhere.
    expect(allowsIssueInteractionWake(resolvedInteractionContext())).toBe(true);
  });

  it("still requires a comment id for plain tree-control comment wakes", () => {
    expect(
      allowsIssueInteractionWake({ issueId: "issue-1", wakeReason: "issue_commented" }),
    ).toBe(false);
    expect(
      allowsIssueInteractionWake({
        issueId: "issue-1",
        wakeReason: "issue_commented",
        wakeCommentId: "comment-1",
      }),
    ).toBe(true);
  });

  it("still rejects non-interaction wakes with non-tree-control reasons", () => {
    expect(
      allowsIssueInteractionWake({ issueId: "issue-1", wakeReason: "issue_assigned" }),
    ).toBe(false);
  });
});

describe("shouldQueueFollowupForRunningIssueWake", () => {
  it("queues a follow-up run instead of coalescing a resolved interaction continuation into a live session", () => {
    expect(
      shouldQueueFollowupForRunningIssueWake({
        contextSnapshot: resolvedInteractionContext(),
        wakeCommentId: null,
      }),
    ).toBe(true);
  });

  it("keeps coalescing for ordinary no-comment wakes", () => {
    expect(
      shouldQueueFollowupForRunningIssueWake({
        contextSnapshot: { issueId: "issue-1", wakeReason: "issue_commented" },
        wakeCommentId: null,
      }),
    ).toBe(false);
  });

  it("keeps existing comment and approval follow-up behavior", () => {
    expect(
      shouldQueueFollowupForRunningIssueWake({
        contextSnapshot: { issueId: "issue-1", wakeReason: "issue_commented" },
        wakeCommentId: "comment-1",
      }),
    ).toBe(true);
    expect(
      shouldQueueFollowupForRunningIssueWake({
        contextSnapshot: { issueId: "issue-1", wakeReason: "approval_approved" },
        wakeCommentId: null,
      }),
    ).toBe(true);
  });
});
