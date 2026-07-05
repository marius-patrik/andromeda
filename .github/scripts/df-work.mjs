import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DATA_REPO,
  WORK_LABELS,
  assertAllowedRepo,
  cleanupTempRoot,
  createGithubClient,
  ensureLabels,
  findOpenWorkerPullRequestForIssue,
  getRepository,
  preflightMergePolicy,
  parseRepo,
  repoName,
  requiredEnv,
  sanitize,
  slug,
  taskClassFromLabels,
  writeRunLedger
} from "./df-lib.mjs";

const CONTROL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const TOKEN = requiredEnv("DARK_FACTORY_TOKEN");
const CODEX_AUTH_JSON = process.env.CODEX_AUTH_JSON ?? "";
const CONTROL_REPO = parseRepo(requiredEnv("DF_CONTROL_REPO"));
const TARGET_REPO = parseRepo(requiredEnv("DF_TARGET_REPO"));
const TARGET_ISSUE_NUMBER = Number(requiredEnv("DF_TARGET_ISSUE_NUMBER"));
const TARGET_BASE_REF = process.env.DF_TARGET_BASE_REF?.trim() || "";
const TRIGGER = process.env.DF_TRIGGER ?? "unknown";
const WORKER_IMAGE = process.env.DF_WORKER_IMAGE ?? "darkfactory-codex-worker";
const CODEX_MODEL = process.env.DF_CODEX_MODEL ?? "gpt-5.5";
const DATA_REPO = process.env.DF_DATA_REPO ?? DEFAULT_DATA_REPO;
const RUN_ID = process.env.GITHUB_RUN_ID || `local-${Date.now()}`;
const RUN_ATTEMPT = process.env.GITHUB_RUN_ATTEMPT || "1";
const PROVIDER_LOCK_STALE_MS = parseProviderLockStaleMs(process.env.DF_PROVIDER_LOCK_STALE_MINUTES);
const GIT_BASIC_AUTH = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
const gh = createGithubClient(TOKEN, "darkfactory-worker");

main().catch((error) => {
  console.error(sanitize(error.stack || error.message || String(error), TOKEN));
  process.exitCode = 1;
});

async function main() {
  if (!Number.isInteger(TARGET_ISSUE_NUMBER) || TARGET_ISSUE_NUMBER <= 0) {
    throw new Error(`Invalid issue number: ${process.env.DF_TARGET_ISSUE_NUMBER}`);
  }

  assertAllowedRepo(TARGET_REPO);

  const issue = await getIssue(TARGET_REPO, TARGET_ISSUE_NUMBER);
  const taskRouting = taskClassFromLabels(issue.labels);
  const codeEffort = taskRouting.effort;
  const target = `${repoName(TARGET_REPO)}#${TARGET_ISSUE_NUMBER}`;
  const branch = `df/${TARGET_ISSUE_NUMBER}-${slug(issue.title)}`;
  const ledger = {
    trigger: TRIGGER,
    issue: target,
    branch,
    status: "started",
    actions: [],
    providers: [],
    provider_order: [],
    provider: null,
    token_usage: {
      codex_calls: 0,
      model: CODEX_MODEL,
      model_reasoning_effort: codeEffort,
      input_tokens: null,
      output_tokens: null,
      note: "codex exec token counters are not exposed to this script yet"
    }
  };
  let tempRoot = "";
  let pullRequest = null;

  const repo = await getRepository(gh, TARGET_REPO);
  const workBaseBranch = await resolveWorkBaseBranch(TARGET_REPO, repo.default_branch, TARGET_BASE_REF);

  // Ensure work labels exist before any preflight failure path tries to apply
  // `df:blocked` to the issue, so the blocker comment is always left reliably.
  // The control repo labels are best-effort: issue/comment triggers in managed
  // repositories run with the repository token, which cannot write to the
  // control repository.
  try {
    await ensureLabels(gh, CONTROL_REPO, WORK_LABELS);
  } catch (error) {
    console.warn(`Could not ensure labels in ${repoName(CONTROL_REPO)}: ${sanitize(error.message || String(error), TOKEN)}`);
  }
  await ensureLabels(gh, TARGET_REPO, WORK_LABELS);

  const existingPullRequest = await findOpenWorkerPullRequestForIssue(gh, TARGET_REPO, TARGET_ISSUE_NUMBER);
  if (existingPullRequest) {
    ledger.status = "success";
    ledger.pull_request = existingPullRequest.url;
    ledger.actions.push({
      action: "existing-worker-pr",
      result: "noop",
      url: existingPullRequest.url,
      branch: existingPullRequest.headRefName
    });
    await replaceIssueLabels(TARGET_REPO, TARGET_ISSUE_NUMBER, ["df:running"], ["df:ready", "df:blocked", "df:done"]);
    await createIssueComment(
      TARGET_REPO,
      TARGET_ISSUE_NUMBER,
      [
        `DarkFactory worker skipped \`${target}\` because an open worker PR already exists.`,
        "",
        `PR: ${existingPullRequest.url || `#${existingPullRequest.number}`}`,
        `Branch: \`${existingPullRequest.headRefName || branch}\``,
        "",
        "No new worker run is needed; follow-through will evaluate the existing PR."
      ].join("\n")
    );
    return;
  }

  const mergePolicy = await preflightMergePolicy(gh, TARGET_REPO, workBaseBranch, repo);
  ledger.actions.push({ action: "preflight-merge-policy", result: mergePolicy });
  if (mergePolicy.blocked) {
    ledger.status = "blocked";
    ledger.error = mergePolicy.reason;
    await replaceIssueLabels(TARGET_REPO, TARGET_ISSUE_NUMBER, ["df:blocked"], ["df:ready", "df:running", "df:done"]);
    await createIssueComment(
      TARGET_REPO,
      TARGET_ISSUE_NUMBER,
      preflightBlockedComment(target, workBaseBranch, mergePolicy)
    );
    return;
  }

  try {
    await replaceIssueLabels(TARGET_REPO, TARGET_ISSUE_NUMBER, ["df:running"], ["df:ready", "df:blocked", "df:done"]);
    await createIssueComment(
      TARGET_REPO,
      TARGET_ISSUE_NUMBER,
      [
        `DarkFactory worker started for \`${target}\` from \`${TRIGGER}\`.`,
        "",
        `Branch: \`${branch}\``,
        `Task class: \`${taskRouting.taskClass}\``,
        `Codex reasoning effort: \`${codeEffort}\``,
        `Merge policy: ${mergePolicy.summary}`
      ].join("\n")
    );

    if (!CODEX_AUTH_JSON.trim() && !hasProviderAuthOverride()) {
      throw new Error("No worker provider auth is configured. Set CODEX_AUTH_JSON or a provider-specific DF_PROVIDER_<NAME>_AUTH_JSON secret.");
    }

    tempRoot = await mkdtemp(path.join(tmpdir(), "df-work-"));
    const worktree = path.join(tempRoot, "repo");

    await cloneRepository(TARGET_REPO, worktree, workBaseBranch);
    await ensureNoRemoteBranch(TARGET_REPO, branch);
    runGit(["checkout", "-b", branch], worktree);

    const briefInfo = await writeTaskBrief(worktree, issue, workBaseBranch, taskRouting);
    ledger.token_usage.input_brief_characters = briefInfo.characters;
    buildWorkerImage();
    const providers = workerProviders();
    ledger.provider_order = providers.map(providerLedgerConfig);
    const workerRun = await runWorkerWithProviderFailover(worktree, tempRoot, providers, codeEffort, ledger);
    ledger.provider = workerRun.provider.name;
    ledger.token_usage.model = workerRun.provider.model;
    ledger.token_usage.provider = workerRun.provider.name;
    ledger.token_usage.provider_kind = workerRun.provider.kind;

    const summary = await readWorkerSummary(worktree);
    await removeWorkerScratch(worktree);

    const changed = gitOutput(["status", "--porcelain"], worktree);
    if (changed.trim()) {
      runGit(["config", "user.name", "DarkFactory"], worktree);
      runGit(["config", "user.email", "darkfactory@users.noreply.github.com"], worktree);
      runGit(["add", "--all"], worktree);
      runGit(["commit", "-m", `feat: implement issue #${TARGET_ISSUE_NUMBER}`], worktree);
    }

    const ahead = Number(gitOutput(["rev-list", "--count", `origin/${workBaseBranch}..HEAD`], worktree));
    if (!Number.isInteger(ahead) || ahead <= 0) {
      throw new Error("Worker completed without producing a commit.");
    }

    runGit(["push", "origin", `HEAD:refs/heads/${branch}`], worktree);
    pullRequest = await createPullRequest(TARGET_REPO, workBaseBranch, branch, issue, summary);
    ledger.pull_request = pullRequest.html_url;

    let automerge;
    try {
      automerge = mergePolicy.useAutomerge
        ? await enableAutoMerge(pullRequest.node_id)
        : { enabled: false, reason: "Direct green-PR sweep will merge after checks because branch protection is not configured." };
    } catch (automergeError) {
      automerge = {
        enabled: false,
        reason: sanitize(automergeError.message || String(automergeError), TOKEN)
      };
    }

    await replaceIssueLabels(TARGET_REPO, TARGET_ISSUE_NUMBER, ["df:done"], ["df:ready", "df:running", "df:blocked"]);
    await createIssueComment(
      TARGET_REPO,
      TARGET_ISSUE_NUMBER,
      [
        `DarkFactory worker opened ${pullRequest.html_url}.`,
        "",
        `Provider: \`${ledger.provider}\` (${ledger.token_usage.model}).`,
        "",
        `Automerge: ${automerge.enabled ? "enabled" : `not enabled (${automerge.reason})`}.`,
        "",
        "Worker summary:",
        "",
        truncate(summary, 5000)
      ].join("\n")
    );
    ledger.status = "success";
    ledger.actions.push({ action: "open-pr", url: pullRequest.html_url, automerge });
  } catch (error) {
    ledger.status = "blocked";
    ledger.error = sanitize(error.stack || error.message || String(error), TOKEN);
    if (pullRequest) {
      ledger.pull_request = pullRequest.html_url;
    }
    try {
      await replaceIssueLabels(TARGET_REPO, TARGET_ISSUE_NUMBER, ["df:blocked"], ["df:ready", "df:running", "df:done"]);
      await createIssueComment(
        TARGET_REPO,
        TARGET_ISSUE_NUMBER,
        [
          "DarkFactory worker blocked.",
          "",
          "Blocker:",
          "",
          "```text",
          truncate(ledger.error, 6000),
          "```"
        ].join("\n")
      );
    } catch (updateError) {
      console.warn(`DarkFactory failed to mark issue blocked: ${sanitize(updateError.stack || updateError.message || String(updateError), TOKEN)}`);
    }
    throw error;
  } finally {
    const cleanup = await cleanupTempRoot(tempRoot, (warning) => console.warn(sanitize(warning, TOKEN)));
    ledger.cleanup = cleanup;
    await writeLedger(ledger);
  }
}

function preflightBlockedComment(target, baseBranch, mergePolicy) {
  return [
    `DarkFactory blocked \`${target}\` before cloning or running Codex.`,
    "",
    "Blocker:",
    "",
    "```text",
    mergePolicy.reason,
    "```",
    "",
    `Target branch: \`${baseBranch}\``,
    `Repository auto-merge enabled: \`${mergePolicy.autoMergeSupported ? "yes" : "no"}\``,
    "",
    "This is target repository setup work, not a code implementation failure."
  ].join("\n");
}

async function getIssue(repository, issueNumber) {
  const issue = await gh.request("GET", `/repos/${repoName(repository)}/issues/${issueNumber}`);
  if (issue.pull_request) {
    throw new Error(`${repoName(repository)}#${issueNumber} is a pull request, not an issue.`);
  }
  if (issue.state !== "open") {
    throw new Error(`${repoName(repository)}#${issueNumber} is not open.`);
  }
  return issue;
}

async function resolveWorkBaseBranch(repository, defaultBranch, requestedBranch = "") {
  if (requestedBranch) {
    await ensureBranchExists(repository, requestedBranch);
    return requestedBranch;
  }

  try {
    await ensureBranchExists(repository, "dev");
    return "dev";
  } catch (error) {
    if (error.status === 404) return defaultBranch;
    throw error;
  }
}

async function ensureBranchExists(repository, branch) {
  await gh.request("GET", `/repos/${repoName(repository)}/git/ref/heads/${encodeRefPath(branch)}`);
}

async function replaceIssueLabels(repository, issueNumber, add, remove) {
  if (add.length) {
    await gh.request("POST", `/repos/${repoName(repository)}/issues/${issueNumber}/labels`, { labels: add });
  }
  for (const label of remove) {
    try {
      await gh.request("DELETE", `/repos/${repoName(repository)}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`);
    } catch (error) {
      if (error.status !== 404) throw error;
    }
  }
}

async function createIssueComment(repository, issueNumber, body) {
  await gh.request("POST", `/repos/${repoName(repository)}/issues/${issueNumber}/comments`, { body });
}

async function cloneRepository(repository, worktree, branch) {
  const url = `https://github.com/${repoName(repository)}.git`;
  runGitWithAuth(["clone", "--depth", "1", "--branch", branch, url, worktree], process.cwd());
}

async function ensureNoRemoteBranch(repository, branch) {
  const refs = await gh.request(
    "GET",
    `/repos/${repoName(repository)}/git/matching-refs/heads/${encodeURIComponent(branch)}`
  );
  if (Array.isArray(refs) && refs.some((ref) => ref.ref === `refs/heads/${branch}`)) {
    throw new Error(`Remote branch already exists: ${branch}`);
  }
}

function hasProviderAuthOverride() {
  return Object.keys(process.env).some((key) => /^DF_PROVIDER_[A-Z0-9_]+_AUTH_JSON$/.test(key) && process.env[key]?.trim());
}

function workerProviders() {
  const names = providerOrder();
  const providers = names.map((name) => {
    const envPrefix = providerEnvPrefix(name);
    const kind = (process.env[`${envPrefix}_KIND`] || "codex").trim().toLowerCase();
    const model = (process.env[`${envPrefix}_MODEL`] || (name === "codex" ? CODEX_MODEL : name)).trim();
    const authJson = process.env[`${envPrefix}_AUTH_JSON`] ?? (name === "codex" ? CODEX_AUTH_JSON : "");
    const concurrency = parseProviderConcurrency(process.env[`${envPrefix}_CONCURRENCY`] ?? process.env.DF_PROVIDER_DEFAULT_CONCURRENCY);

    return {
      name,
      kind,
      model,
      authJson,
      concurrency
    };
  });

  const usable = providers.filter((provider) => provider.authJson.trim());
  if (usable.length === 0) {
    throw new Error(`No configured worker provider in ${names.join(", ")} has auth JSON.`);
  }
  return usable;
}

function providerOrder() {
  const configured = process.env.DF_WORKER_PROVIDERS || process.env.DF_PROVIDER_ORDER || "codex";
  const names = configured
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const unique = [...new Set(names)];
  if (unique.length === 0) throw new Error("DF_WORKER_PROVIDERS did not contain any provider names.");
  for (const name of unique) {
    if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(name)) {
      throw new Error(`Invalid worker provider name '${name}'. Use lowercase letters, numbers, '-' or '_'.`);
    }
  }
  return unique;
}

function providerEnvPrefix(name) {
  return `DF_PROVIDER_${name.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
}

function parseProviderConcurrency(value) {
  const parsed = Number(value ?? 1);
  if (!Number.isInteger(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 50);
}

function providerLedgerConfig(provider) {
  return {
    name: provider.name,
    kind: provider.kind,
    model: provider.model,
    concurrency: provider.concurrency
  };
}

async function runWorkerWithProviderFailover(worktree, tempRoot, providers, codeEffort, ledger) {
  const skipped = [];

  for (const provider of providers) {
    const attempt = {
      provider: provider.name,
      kind: provider.kind,
      model: provider.model,
      concurrency: provider.concurrency,
      status: "started"
    };
    ledger.providers.push(attempt);

    const lock = await acquireProviderLock(provider);
    if (!lock) {
      attempt.status = "skipped";
      attempt.reason = "concurrency-exhausted";
      skipped.push(provider.name);
      continue;
    }

    attempt.lock = { repository: repoName(lock.repository), ref: lock.ref };
    const codexHome = path.join(tempRoot, `codex-home-${provider.name}`);

    try {
      await writeCodexAuth(codexHome, provider.authJson);
      ledger.token_usage.codex_calls += 1;
      runCodexWorker(worktree, codexHome, codeEffort, provider);
      attempt.status = "success";
      return { provider, attempt };
    } catch (error) {
      const message = sanitize(error.stack || error.message || String(error), TOKEN);
      attempt.error = truncate(message, 4000);
      if (!isProviderQuotaError(message)) {
        attempt.status = "failed";
        throw error;
      }

      attempt.status = "quota-exhausted";
      cleanupWorkerAttempt(worktree);
      continue;
    } finally {
      await releaseProviderLock(lock);
    }
  }

  throw new Error(`All configured worker providers are unavailable or quota-exhausted. Providers: ${providers.map((provider) => provider.name).join(", ")}. Concurrency skipped: ${skipped.join(", ") || "none"}.`);
}

async function acquireProviderLock(provider) {
  const dataRepo = parseRepo(DATA_REPO);
  const head = await dataRepoHead(dataRepo);
  const sha = await createProviderLockCommit(dataRepo, head, provider);
  const providerSlug = provider.name.replace(/_/g, "-");

  for (let slot = 0; slot < provider.concurrency; slot += 1) {
    const ref = `refs/heads/df-lock/${providerSlug}/slot-${slot}`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await gh.request("POST", `/repos/${repoName(dataRepo)}/git/refs`, {
          ref,
          sha
        });
        return { repository: dataRepo, ref, slot };
      } catch (error) {
        if (error.status !== 422) throw error;
        if (attempt === 0 && await deleteStaleProviderLock(dataRepo, ref)) continue;
        break;
      }
    }
  }

  return null;
}

async function releaseProviderLock(lock) {
  if (!lock) return;
  try {
    await gh.request("DELETE", `/repos/${repoName(lock.repository)}/git/refs/${encodeRefPath(lock.ref.replace(/^refs\//, ""))}`);
  } catch (error) {
    if (error.status !== 404) {
      console.warn(`DarkFactory provider lock cleanup warning: ${sanitize(error.message || String(error), TOKEN)}`);
    }
  }
}

async function dataRepoHead(dataRepo) {
  const repo = await getRepository(gh, dataRepo);
  const branch = repo.default_branch || "main";
  const ref = await gh.request("GET", `/repos/${repoName(dataRepo)}/git/ref/heads/${encodeRefPath(branch)}`);
  if (!ref.object?.sha) {
    throw new Error(`Could not resolve ${repoName(dataRepo)} default branch '${branch}' for provider locking.`);
  }
  const commit = await gh.request("GET", `/repos/${repoName(dataRepo)}/git/commits/${ref.object.sha}`);
  if (!commit.tree?.sha) {
    throw new Error(`Could not resolve ${repoName(dataRepo)} default branch tree for provider locking.`);
  }
  return { branch, sha: ref.object.sha, treeSha: commit.tree.sha };
}

async function createProviderLockCommit(dataRepo, head, provider) {
  const commit = await gh.request("POST", `/repos/${repoName(dataRepo)}/git/commits`, {
    message: [
      "DarkFactory provider lock",
      "",
      `provider: ${provider.name}`,
      `run_id: ${RUN_ID}`,
      `run_attempt: ${RUN_ATTEMPT}`,
      `created_at: ${new Date().toISOString()}`,
      `target: ${repoName(TARGET_REPO)}#${TARGET_ISSUE_NUMBER}`
    ].join("\n"),
    tree: head.treeSha,
    parents: [head.sha]
  });
  if (!commit.sha) throw new Error(`Could not create ${provider.name} provider lock commit.`);
  return commit.sha;
}

async function deleteStaleProviderLock(dataRepo, ref) {
  try {
    const lockRef = await gh.request("GET", `/repos/${repoName(dataRepo)}/git/ref/${encodeRefPath(ref.replace(/^refs\//, ""))}`);
    const commitSha = lockRef.object?.sha;
    if (!commitSha) return false;

    const commit = await gh.request("GET", `/repos/${repoName(dataRepo)}/git/commits/${commitSha}`);
    const createdAt = providerLockCreatedAt(commit.message || "");
    if (!createdAt || Date.now() - createdAt.getTime() < PROVIDER_LOCK_STALE_MS) return false;

    await gh.request("DELETE", `/repos/${repoName(dataRepo)}/git/refs/${encodeRefPath(ref.replace(/^refs\//, ""))}`);
    return true;
  } catch (error) {
    if (error.status === 404) return false;
    throw error;
  }
}

function providerLockCreatedAt(message) {
  const match = message.match(/^created_at:\s*(.+)$/m);
  if (!match) return null;
  const date = new Date(match[1]);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseProviderLockStaleMs(value) {
  const minutes = Number(value ?? 360);
  if (!Number.isFinite(minutes) || minutes < 5) return 360 * 60 * 1000;
  return Math.min(minutes, 24 * 60) * 60 * 1000;
}

function isProviderQuotaError(message) {
  return /\b(rate limit|rate-limit|quota|billing[- ]?cycle|billing|usage limit|too many requests|429|403|resource[_ -]?exhausted|insufficient_quota|limit reached|overloaded)\b/i.test(message);
}

function cleanupWorkerAttempt(worktree) {
  try {
    runGit(["reset", "--hard", "HEAD"], worktree);
  } catch (error) {
    console.warn(`DarkFactory worker attempt cleanup warning: ${sanitize(error.message || String(error), TOKEN)}`);
  }
}

async function writeCodexAuth(codexHome, authJson) {
  await mkdir(codexHome, { recursive: true });
  await writeFile(path.join(codexHome, "auth.json"), authJson, { mode: 0o600 });
}

async function writeTaskBrief(worktree, issue, defaultBranch, taskRouting) {
  const scratchDir = path.join(worktree, ".darkfactory");
  await mkdir(scratchDir, { recursive: true });

  const agentsContext = await readOptional(path.join(worktree, "AGENTS.md"));
  const prdContext = await readOptional(path.join(worktree, "PRD.md"));
  const issueLabels = Array.isArray(issue.labels)
    ? issue.labels.map((label) => typeof label === "string" ? label : label.name).filter(Boolean).join(", ")
    : "";

  const brief = [
    "# DarkFactory Worker Brief",
    "",
    `Target repository: ${repoName(TARGET_REPO)}`,
    `Default branch: ${defaultBranch}`,
    `Issue: #${TARGET_ISSUE_NUMBER}`,
    `Title: ${issue.title}`,
    `Labels: ${issueLabels || "(none)"}`,
    `Task class: ${taskRouting.taskClass}`,
    `Codex reasoning effort: ${taskRouting.effort}`,
    "",
    "## Contract",
    "",
    "The issue body, especially any Acceptance Criteria section, is the definition of done.",
    "Implement only this issue. Do not push, create pull requests, merge, or force-push; DarkFactory handles GitHub writes after you finish.",
    "Run the repository's documented validation commands before finishing. If validation cannot be run, explain the blocker in the final summary.",
    "Keep secrets out of files and logs.",
    "",
    "## Issue Body",
    "",
    issue.body?.trim() || "(issue body is empty)",
    "",
    "## Acceptance Criteria",
    "",
    extractAcceptanceCriteria(issue.body || "") || "Use the issue body as the acceptance criteria.",
    "",
    "## Root AGENTS.md",
    "",
    agentsContext || "(AGENTS.md not present)",
    "",
    "## Root PRD.md",
    "",
    prdContext || "(PRD.md not present)"
  ].join("\n");

  await writeFile(path.join(scratchDir, "df-task-brief.md"), `${brief}\n`);
  return { characters: brief.length };
}

function buildWorkerImage() {
  const dockerfile = path.join(CONTROL_ROOT, ".github", "codex-review.Dockerfile");
  runCommand("docker", ["build", "-f", dockerfile, "-t", WORKER_IMAGE, CONTROL_ROOT], process.cwd());
}

function runCodexWorker(worktree, codexHome, codeEffort, provider) {
  if (provider.kind !== "codex") {
    throw new Error(`Unsupported worker provider kind '${provider.kind}' for provider '${provider.name}'.`);
  }

  const script = [
    "set -euo pipefail",
    "git config --global --add safe.directory /workspace",
    "cd /workspace",
    "codex exec --cd /workspace --model \"${CODEX_MODEL}\" -c \"model_reasoning_effort=\\\"${CODEX_EFFORT}\\\"\" --sandbox danger-full-access --output-last-message .darkfactory/df-worker-summary.md - < .darkfactory/df-task-brief.md"
  ].join("\n");

  runCommand(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "bash",
      "-e",
      "CODEX_HOME=/codex-home",
      "-e",
      "HOME=/codex-home",
      "-e",
      `CODEX_MODEL=${provider.model}`,
      "-e",
      `CODEX_EFFORT=${codeEffort}`,
      "-v",
      `${worktree}:/workspace`,
      "-v",
      `${codexHome}:/codex-home`,
      WORKER_IMAGE,
      "-lc",
      script
    ],
    process.cwd()
  );
}

async function readWorkerSummary(worktree) {
  const summary = await readOptional(path.join(worktree, ".darkfactory", "df-worker-summary.md"));
  return summary?.trim() || "Worker completed without a written summary.";
}

async function removeWorkerScratch(worktree) {
  await rm(path.join(worktree, ".darkfactory", "df-task-brief.md"), { force: true });
  await rm(path.join(worktree, ".darkfactory", "df-worker-summary.md"), { force: true });
}

async function createPullRequest(repository, base, branch, issue, summary) {
  return await gh.request("POST", `/repos/${repoName(repository)}/pulls`, {
    title: issue.title,
    head: branch,
    base,
    body: [
      `<!-- dark-factory:worker-pr issue=${TARGET_ISSUE_NUMBER} -->`,
      "## DarkFactory Worker Summary",
      "",
      truncate(summary, 10000),
      "",
      `Closes #${TARGET_ISSUE_NUMBER}`
    ].join("\n")
  });
}

async function enableAutoMerge(pullRequestId) {
  try {
    await gh.graphql(
      `mutation EnableAutoMerge($pullRequestId: ID!) {
        enablePullRequestAutoMerge(input: {pullRequestId: $pullRequestId, mergeMethod: SQUASH}) {
          pullRequest { url }
        }
      }`,
      { pullRequestId }
    );
    return { enabled: true, reason: "" };
  } catch (error) {
    return { enabled: false, reason: sanitize(error.message || String(error), TOKEN) };
  }
}

function runGit(args, cwd) {
  return runGitWithAuth(args, cwd);
}

function gitOutput(args, cwd) {
  return runGitWithAuth(args, cwd).trim();
}

function runGitWithAuth(args, cwd) {
  return runCommand("git", ["-c", authHeader(), ...args], cwd);
}

function authHeader() {
  return `http.https://github.com/.extraheader=AUTHORIZATION: basic ${GIT_BASIC_AUTH}`;
}

function encodeRefPath(ref) {
  return String(ref || "").split("/").map(encodeURIComponent).join("/");
}

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
    env: process.env
  });
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status}\n${sanitize(result.stdout || "", TOKEN)}\n${sanitize(result.stderr || "", TOKEN)}`.trim());
  }
  return result.stdout || "";
}

async function readOptional(filePath) {
  if (!existsSync(filePath)) return "";
  return await readFile(filePath, "utf8");
}

function extractAcceptanceCriteria(body) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^#{1,6}\s+acceptance criteria\s*$/i.test(line.trim()));
  if (start === -1) return "";
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s+\S/.test(line.trim())) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}\n\n[truncated from ${value.length} characters]`;
}

async function writeLedger(ledger) {
  try {
    ledger.ledger = await writeRunLedger(gh, DATA_REPO, "df-work", repoName(TARGET_REPO), ledger);
    console.log(`DarkFactory ledger written to ${ledger.ledger.repository}/${ledger.ledger.path}`);
  } catch (error) {
    console.warn(sanitize(`DarkFactory ledger warning: ${error.message || String(error)}`, TOKEN));
  }
}
