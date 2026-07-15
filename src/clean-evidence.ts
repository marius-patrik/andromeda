import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import {
  buildCleanPlan,
  stableHash,
  verifyCleanPlanAdmission,
  type CleanBranchEvidence,
  type CleanEvidence,
  type CleanPlan,
  type CleanWorktreeEvidence
} from "./operator.js";

export interface OperatorGitHubRequester {
  request(route: string, parameters: Record<string, unknown>): Promise<{ data: unknown }>;
}

export interface RepositoryRef {
  owner: string;
  repo: string;
}

interface LocalCleanEvidence {
  worktreesByBranch: Map<string, CleanWorktreeEvidence[]>;
  rawWorktreeById: Map<string, string>;
  localBranches: Map<string, { head: string; ahead: number | null; unpublished: boolean }>;
  orphanRefs: CleanEvidence["orphanRefs"];
}

export async function collectCleanEvidence(
  github: OperatorGitHubRequester,
  repository: RepositoryRef,
  localPath = ""
): Promise<CleanEvidence> {
  const metadata = asRecord((await github.request("GET /repos/{owner}/{repo}", { ...repository })).data, "repository metadata");
  const defaultBranch = requiredString(metadata.default_branch, "repository default branch");
  const branches = await listPages(github, "GET /repos/{owner}/{repo}/branches", { ...repository });
  const pulls = await listPages(github, "GET /repos/{owner}/{repo}/pulls", { ...repository, state: "all", sort: "updated", direction: "desc" });
  const issues = await listPages(github, "GET /repos/{owner}/{repo}/issues", { ...repository, state: "open", sort: "updated", direction: "desc" });
  const branchRecords = branches.map((branch, index) => asRecord(branch, `branch ${index}`));
  const branchHeads = new Map<string, string>();
  for (const branch of branchRecords) {
    const name = requiredString(branch.name, "branch name");
    const commit = asRecord(branch.commit, `branch ${name} commit`);
    branchHeads.set(name, requiredString(commit.sha, `branch ${name} head`));
  }
  const policyBranches = new Set([defaultBranch, "main", "dev"].filter((name) => branchHeads.has(name)));
  const local = localPath ? collectLocalEvidence(localPath, branchHeads) : emptyLocalEvidence();
  const trees = new Map<string, string>();
  for (const [name, head] of branchHeads) trees.set(name, await commitTree(github, repository, head));

  const normalizedPulls = pulls.map((pull, index) => normalizePull(pull, index, repository));
  const cleanBranches: CleanBranchEvidence[] = [];
  for (const branch of branchRecords) {
    const name = requiredString(branch.name, "branch name");
    const head = branchHeads.get(name)!;
    const openPull = normalizedPulls.find((pull) => pull.state === "open" && pull.headRef === name && pull.headSha === head && pull.sameRepository);
    const mergedPull = normalizedPulls.find((pull) => pull.merged && pull.headRef === name && pull.headSha === head && pull.sameRepository);
    const containedBy: string[] = [];
    for (const policy of policyBranches) {
      if (policy === name) continue;
      if (await isHeadContainedBy(github, repository, head, policy)) containedBy.push(policy);
    }
    const tree = trees.get(name)!;
    const treeEquivalentTo = [...policyBranches]
      .filter((policy) => policy !== name && trees.get(policy) === tree)
      .sort();
    const localBranch = local.localBranches.get(name);
    cleanBranches.push({
      name,
      head,
      tree,
      protected: branch.protected === true,
      policyBranch: policyBranches.has(name),
      openPullRequest: openPull?.number ?? null,
      mergedPullRequest: mergedPull?.number ?? null,
      mergedPullHead: mergedPull?.headSha ?? null,
      containedBy: containedBy.sort(),
      treeEquivalentTo,
      localAhead: localBranch?.ahead ?? null,
      localUnpublished: localBranch?.unpublished ?? false,
      worktrees: local.worktreesByBranch.get(name) ?? []
    });
  }

  const prdFingerprint = await contentFingerprint(github, repository, "PRD.md", defaultBranch);
  return {
    repository: `${repository.owner}/${repository.repo}`,
    defaultBranch,
    observedRefs: Object.fromEntries([...branchHeads].filter(([name]) => policyBranches.has(name)).sort(([a], [b]) => a.localeCompare(b))),
    branches: cleanBranches.sort((a, b) => a.name.localeCompare(b.name)),
    orphanRefs: local.orphanRefs,
    pullRequestFingerprint: stableHash(normalizedPulls.map((pull) => ({
      number: pull.number,
      state: pull.state,
      merged: pull.merged,
      headRef: pull.headRef,
      headSha: pull.headSha,
      baseRef: pull.baseRef,
      updatedAt: pull.updatedAt
    }))),
    issueLaneFingerprint: stableHash(issues
      .filter((issue) => !asRecord(issue, "issue").pull_request)
      .map((issue) => {
        const value = asRecord(issue, "issue");
        return {
          number: value.number,
          title: value.title,
          body: value.body,
          state: value.state,
          labels: Array.isArray(value.labels) ? value.labels : [],
          updated_at: value.updated_at
        };
      })),
    prdFingerprint
  };
}

export interface CleanApplyReceipt {
  planId: string;
  repository: string;
  actions: Array<{ kind: string; target: string; head: string; status: "applied" | "skipped"; reason: string }>;
}

export async function applyCleanPlan(
  github: OperatorGitHubRequester,
  repository: RepositoryRef,
  saved: CleanPlan,
  freshEvidence: CleanEvidence,
  options: {
    localPath?: string;
    onApplied?: (receipt: CleanApplyReceipt["actions"][number]) => Promise<void>;
  } = {}
): Promise<CleanApplyReceipt> {
  const fresh = buildCleanPlan(freshEvidence, new Date(saved.createdAt));
  verifyCleanPlanAdmission(saved, fresh);
  const local = options.localPath ? collectLocalEvidence(options.localPath, new Map(freshEvidence.branches.map((branch) => [branch.name, branch.head]))) : emptyLocalEvidence();
  const actions: CleanApplyReceipt["actions"] = [];

  // Remove exact clean worktree copies first. `git worktree remove` has no
  // force flag here and therefore remains fail-closed if Git observes drift.
  for (const entry of saved.entries.filter((candidate) => candidate.kind === "worktree" && candidate.action === "remove")) {
    const rawPath = local.rawWorktreeById.get(entry.target);
    if (!options.localPath || !rawPath) throw new Error(`clean worktree ${entry.target} is no longer observable; apply aborted`);
    runGit(options.localPath, ["worktree", "remove", "--", rawPath]);
    await recordApplied(actions, { kind: entry.kind, target: entry.target, head: entry.head, status: "applied", reason: "exact clean preserved worktree removed" }, options.onApplied);
  }

  for (const entry of saved.entries.filter((candidate) => candidate.kind === "orphan-ref" && candidate.action === "delete")) {
    if (!options.localPath) throw new Error(`clean orphan ref ${entry.target} requires an explicit local checkout`);
    runGit(options.localPath, ["update-ref", "-d", entry.target, entry.head]);
    await recordApplied(actions, { kind: entry.kind, target: entry.target, head: entry.head, status: "applied", reason: "atomic exact-head deletion after independent preservation proof" }, options.onApplied);
  }

  for (const entry of saved.entries.filter((candidate) => candidate.kind === "remote-branch" && candidate.action === "delete")) {
    const current = asRecord((await github.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
      ...repository,
      ref: `heads/${entry.target}`
    })).data, `remote branch ${entry.target}`);
    const object = asRecord(current.object, `remote branch ${entry.target} object`);
    if (object.sha !== entry.head) throw new Error(`remote branch ${entry.target} drifted immediately before deletion; apply aborted`);
    await github.request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", { ...repository, ref: `heads/${entry.target}` });
    await recordApplied(actions, { kind: entry.kind, target: entry.target, head: entry.head, status: "applied", reason: "exact head independently preserved and re-fetched" }, options.onApplied);
  }

  for (const entry of saved.entries.filter((candidate) => candidate.action === "preserve")) {
    actions.push({ kind: entry.kind, target: entry.target, head: entry.head, status: "skipped", reason: entry.reasons.join(" ") });
  }
  return { planId: saved.planId, repository: saved.repository, actions };
}

async function recordApplied(
  actions: CleanApplyReceipt["actions"],
  receipt: CleanApplyReceipt["actions"][number],
  callback?: (receipt: CleanApplyReceipt["actions"][number]) => Promise<void>
): Promise<void> {
  actions.push(receipt);
  if (callback) await callback(receipt);
}

function collectLocalEvidence(localPath: string, remoteBranches: Map<string, string>): LocalCleanEvidence {
  const root = resolve(localPath);
  const worktreesByBranch = new Map<string, CleanWorktreeEvidence[]>();
  const rawWorktreeById = new Map<string, string>();
  const porcelain = runGit(root, ["worktree", "list", "--porcelain"]);
  const records = porcelain.split(/\r?\n\r?\n/).map((block) => block.trim()).filter(Boolean);
  for (const record of records) {
    const fields = new Map(record.split(/\r?\n/).map((line) => {
      const separator = line.indexOf(" ");
      return separator === -1 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
    }));
    const worktreePath = fields.get("worktree") || "";
    const head = fields.get("HEAD") || "";
    const ref = fields.get("branch") || "";
    if (!worktreePath || !head || !ref.startsWith("refs/heads/")) continue;
    const branch = ref.slice("refs/heads/".length);
    const status = runGit(worktreePath, ["status", "--porcelain=v2", "--untracked-files=all", "--ignore-submodules=none"]);
    const lines = status.split(/\r?\n/).filter(Boolean);
    const pathId = `wt-${createHash("sha256").update(resolve(worktreePath).toLowerCase()).digest("hex").slice(0, 16)}`;
    const evidence: CleanWorktreeEvidence = {
      pathId,
      branch,
      head,
      dirty: lines.some((line) => !line.startsWith("? ")),
      untracked: lines.some((line) => line.startsWith("? ")),
      submoduleDirty: lines.some((line) => /^[12u] .{2}S/.test(line))
    };
    worktreesByBranch.set(branch, [...(worktreesByBranch.get(branch) || []), evidence]);
    rawWorktreeById.set(pathId, resolve(worktreePath));
  }

  const localBranches = new Map<string, { head: string; ahead: number | null; unpublished: boolean }>();
  const refs = runGit(root, ["for-each-ref", "--format=%(refname:short)%09%(objectname)", "refs/heads"]);
  for (const line of refs.split(/\r?\n/).filter(Boolean)) {
    const [name, head] = line.split("\t");
    if (!name || !head) continue;
    const remoteHead = remoteBranches.get(name);
    let ahead: number | null = null;
    if (remoteHead) {
      const counts = runGit(root, ["rev-list", "--left-right", "--count", `${remoteHead}...${head}`]).trim().split(/\s+/).map(Number);
      ahead = Number.isFinite(counts[1]) ? counts[1] : null;
    }
    localBranches.set(name, { head, ahead, unpublished: !remoteHead || (ahead !== null && ahead > 0) });
  }

  const orphanRefs: CleanEvidence["orphanRefs"] = [];
  const orphanOutput = runGit(root, ["for-each-ref", "--format=%(refname)%09%(objectname)%09%(*objectname)", "refs/df", "refs/archive", "refs/subtree"]);
  const branchPreservation = new Map<string, string[]>();
  for (const [name, head] of remoteBranches) branchPreservation.set(head, [...(branchPreservation.get(head) || []), `branch:${name}`]);
  for (const line of orphanOutput.split(/\r?\n/).filter(Boolean)) {
    const [ref, object, peeled] = line.split("\t");
    const head = peeled || object;
    if (!ref || !head) continue;
    const tree = runGit(root, ["rev-parse", `${head}^{tree}`]).trim();
    const preserved = [...(branchPreservation.get(head) || [])];
    if (preserved.length === 0) {
      for (const [name, branchHead] of remoteBranches) {
        const branchTree = runGit(root, ["rev-parse", `${branchHead}^{tree}`]).trim();
        if (branchTree === tree) preserved.push(`tree:branch:${name}`);
      }
    }
    orphanRefs.push({ ref, head, tree, independentlyPreservedBy: preserved.sort(), worktree: null });
  }
  return { worktreesByBranch, rawWorktreeById, localBranches, orphanRefs: orphanRefs.sort((a, b) => a.ref.localeCompare(b.ref)) };
}

function emptyLocalEvidence(): LocalCleanEvidence {
  return { worktreesByBranch: new Map(), rawWorktreeById: new Map(), localBranches: new Map(), orphanRefs: [] };
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync("git", ["-C", resolve(cwd), ...args], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 16 * 1024 * 1024
  });
}

async function listPages(github: OperatorGitHubRequester, route: string, parameters: Record<string, unknown>): Promise<unknown[]> {
  const values: unknown[] = [];
  for (let page = 1; page <= 20; page += 1) {
    const response = await github.request(route, { ...parameters, per_page: 100, page });
    if (!Array.isArray(response.data)) throw new Error(`${route} returned malformed pagination data`);
    values.push(...response.data);
    if (response.data.length < 100) return values;
  }
  throw new Error(`${route} exceeded the bounded 2000-record evidence window`);
}

async function commitTree(github: OperatorGitHubRequester, repository: RepositoryRef, sha: string): Promise<string> {
  const commit = asRecord((await github.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
    ...repository,
    commit_sha: sha
  })).data, `commit ${sha}`);
  return requiredString(asRecord(commit.tree, `commit ${sha} tree`).sha, `commit ${sha} tree sha`);
}

async function isHeadContainedBy(github: OperatorGitHubRequester, repository: RepositoryRef, branchHead: string, policyBranch: string): Promise<boolean> {
  const comparison = asRecord((await github.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
    ...repository,
    basehead: `${branchHead}...${policyBranch}`
  })).data, `comparison ${branchHead}...${policyBranch}`);
  const mergeBase = asRecord(comparison.merge_base_commit, "comparison merge base");
  return mergeBase.sha === branchHead;
}

async function contentFingerprint(github: OperatorGitHubRequester, repository: RepositoryRef, path: string, ref: string): Promise<string> {
  try {
    const content = asRecord((await github.request("GET /repos/{owner}/{repo}/contents/{path}", { ...repository, path, ref })).data, `${path} content`);
    return typeof content.sha === "string" ? content.sha : stableHash(content);
  } catch (error) {
    if (isStatus(error, 404)) return "missing";
    throw error;
  }
}

function normalizePull(value: unknown, index: number, repository: RepositoryRef): {
  number: number;
  state: string;
  merged: boolean;
  headRef: string;
  headSha: string;
  baseRef: string;
  sameRepository: boolean;
  updatedAt: string;
} {
  const pull = asRecord(value, `pull request ${index}`);
  const head = asRecord(pull.head, `pull request ${index} head`);
  const base = asRecord(pull.base, `pull request ${index} base`);
  const headRepo = head.repo ? asRecord(head.repo, `pull request ${index} head repo`) : {};
  const owner = headRepo.owner ? asRecord(headRepo.owner, `pull request ${index} head owner`) : {};
  return {
    number: requiredNumber(pull.number, `pull request ${index} number`),
    state: requiredString(pull.state, `pull request ${index} state`),
    merged: Boolean(pull.merged_at),
    headRef: requiredString(head.ref, `pull request ${index} head ref`),
    headSha: requiredString(head.sha, `pull request ${index} head sha`),
    baseRef: requiredString(base.ref, `pull request ${index} base ref`),
    sameRepository: String(owner.login || "").toLowerCase() === repository.owner.toLowerCase()
      && String(headRepo.name || "").toLowerCase() === repository.repo.toLowerCase(),
    updatedAt: requiredString(pull.updated_at, `pull request ${index} updated_at`)
  };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} is malformed or unobservable`);
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) throw new Error(`${label} is malformed or unobservable`);
  return value;
}

function requiredNumber(value: unknown, label: string): number {
  if (!Number.isInteger(value)) throw new Error(`${label} is malformed or unobservable`);
  return value as number;
}

function isStatus(error: unknown, status: number): boolean {
  return Boolean(error && typeof error === "object" && "status" in error && (error as { status?: number }).status === status);
}
