import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCleanPlan,
  planSetupConvergence,
  verifyCleanPlanAdmission,
  type CleanBranchEvidence,
  type CleanEvidence,
  type DoctorReport
} from "../src/operator.js";

function report(findings: DoctorReport["findings"]): DoctorReport {
  return {
    schema_version: 2,
    target_repository: "marius-patrik/example",
    lifecycle: "active",
    source_refs: { main: "main-sha", dev: "dev-sha" },
    findings
  };
}

test("setup plan orders trusted convergence stages and preserves owner residue", () => {
  const plan = planSetupConvergence([report([
    { id: "root-prd-missing", category: "PRD drift", message: "missing", severity: "error", repair_class: "pr" },
    { id: "runner-health", category: "runner health", message: "offline", severity: "critical", repair_class: "auto" },
    { id: "required-secret-key-missing", category: "configuration prerequisites", message: "owner secret", severity: "critical", repair_class: "owner" },
    { id: "protection-main-strict-missing", category: "branch protection", message: "strict", severity: "critical", repair_class: "auto" }
  ])]);

  assert.deepEqual(plan.actions.map((action) => action.stage), [
    "machine-wiring",
    "repository-bootstrap",
    "settings-enforcement"
  ]);
  assert.deepEqual(plan.residue.map((item) => [item.findingId, item.repairClass]), [
    ["required-secret-key-missing", "owner"]
  ]);
});

test("clean plan deletes only exact independently preserved branch heads", () => {
  const safe = branch({
    name: "merged-feature",
    head: "feature-sha",
    tree: "feature-tree",
    containedBy: ["main"],
    treeEquivalentTo: []
  });
  const plan = buildCleanPlan(evidence([safe]), new Date("2026-07-15T00:00:00Z"));

  assert.deepEqual(plan.entries.map((entry) => [entry.target, entry.classification, entry.action]), [
    ["merged-feature", "proven-merged", "delete"]
  ]);
});

test("clean plan removes a clean worktree only when its exact head is independently preserved", () => {
  const safe = branch({
    name: "merged-worktree",
    containedBy: ["dev"],
    worktrees: [{ pathId: "wt-safe", branch: "merged-worktree", head: "merged-worktree-sha", dirty: false, untracked: false, submoduleDirty: false }]
  });
  const plan = buildCleanPlan(evidence([safe]), new Date("2026-07-15T00:00:00Z"));

  assert.deepEqual(plan.entries.map((entry) => [entry.kind, entry.action]), [
    ["remote-branch", "delete"],
    ["worktree", "remove"]
  ]);
});

test("clean plan preserves dirty, unpublished, open-PR, and ambiguous human work", () => {
  const branches = [
    branch({ name: "dirty", worktrees: [{ pathId: "wt-dirty", branch: "dirty", head: "dirty-sha", dirty: true, untracked: false, submoduleDirty: false }] }),
    branch({ name: "unpublished", localUnpublished: true }),
    branch({ name: "review", openPullRequest: 7 }),
    branch({ name: "unknown" })
  ];
  const plan = buildCleanPlan(evidence(branches), new Date("2026-07-15T00:00:00Z"));
  const remoteEntries = plan.entries.filter((entry) => entry.kind === "remote-branch");

  assert.deepEqual(remoteEntries.map((entry) => [entry.target, entry.classification, entry.action]), [
    ["dirty", "dirty-worktree", "preserve"],
    ["review", "open-pr", "preserve"],
    ["unknown", "ambiguous", "preserve"],
    ["unpublished", "unpublished", "preserve"]
  ]);
});

test("clean apply admission aborts when any observed fact drifts", () => {
  const original = buildCleanPlan(evidence([branch({ name: "merged", containedBy: ["main"] })]), new Date("2026-07-15T00:00:00Z"));
  const drifted = buildCleanPlan(evidence([branch({ name: "merged", head: "new-head", containedBy: ["main"] })]), new Date("2026-07-15T00:01:00Z"));

  assert.throws(() => verifyCleanPlanAdmission(original, drifted), /evidence drifted/);
});

function branch(overrides: Partial<CleanBranchEvidence>): CleanBranchEvidence {
  return {
    name: "feature",
    head: `${overrides.name || "feature"}-sha`,
    tree: `${overrides.name || "feature"}-tree`,
    protected: false,
    policyBranch: false,
    openPullRequest: null,
    mergedPullRequest: null,
    mergedPullHead: null,
    containedBy: [],
    treeEquivalentTo: [],
    localAhead: null,
    localUnpublished: false,
    worktrees: [],
    ...overrides
  };
}

function evidence(branches: CleanBranchEvidence[]): CleanEvidence {
  return {
    repository: "marius-patrik/example",
    defaultBranch: "main",
    observedRefs: { main: "main-sha", dev: "dev-sha" },
    branches,
    orphanRefs: [],
    pullRequestFingerprint: "prs-v1",
    issueLaneFingerprint: "issues-v1",
    prdFingerprint: "prd-v1"
  };
}
