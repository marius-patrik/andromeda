import {
  DEFAULT_DATA_REPO,
  PLANNING_LABELS,
  WORK_LABELS,
  assertAllowedRepo,
  auditIssueBody,
  createGithubClient,
  ensureLabels,
  findAuditMarker,
  findPrdMarker,
  getBranchProtection,
  getOptionalFileContent,
  getRepository,
  isActiveManagedRepo,
  listActiveManagedRepos,
  listIssues,
  parseRepo,
  readManagedRepoRegistry,
  repoName,
  requiredEnv,
  slug,
  warnReadOnlyRepository,
  writeRunLedger
} from "./df-lib.mjs";

const TOKEN = requiredEnv("DARK_FACTORY_TOKEN");
const CONTROL_REPO = parseRepo(requiredEnv("DF_CONTROL_REPO"));
let TARGET_REPO = parseRepo(process.env.DF_TARGET_REPO?.trim() || repoName(CONTROL_REPO));
const DATA_REPO = process.env.DF_DATA_REPO ?? DEFAULT_DATA_REPO;
const TRIGGER = process.env.DF_TRIGGER ?? "unknown";
const AUDIT_ALL = process.env.DF_AUDIT_ALL === "true";
const gh = createGithubClient(TOKEN, "darkfactory-audit");

const REQUIRED_FILES = [
  "AGENTS.md",
  "PRD.md",
  ".github/workflows/ci.yml",
  ".github/workflows/codex-review.yml",
  ".github/workflows/df-work.yml",
  ".github/workflows/df-plan.yml"
];
const DOC_PATHS = ["PRD.md", "AGENTS.md", ".agents/.project/STATUS.md", ".agents/.project/PROJECT.md"];
const DOC_STALE_DAYS = 90;

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  process.exitCode = 1;
});

async function main() {
  const registry = await readManagedRepoRegistry();
  const targets = AUDIT_ALL ? await listActiveManagedRepos(gh, CONTROL_REPO, { registry }) : [TARGET_REPO];
  for (const target of targets) {
    TARGET_REPO = target;
    if (!isActiveManagedRepo(TARGET_REPO, registry)) {
      console.warn(`DarkFactory audit skipped ${repoName(TARGET_REPO)} because managed lifecycle state is not active.`);
      continue;
    }
    try {
      await auditTargetRepository();
    } catch (error) {
      if (warnReadOnlyRepository(TARGET_REPO, error, "audit")) continue;
      throw error;
    }
  }
}

async function auditTargetRepository() {
  assertAllowedRepo(TARGET_REPO);
  const repo = await getRepository(gh, TARGET_REPO);
  if (repo.archived === true || repo.disabled === true) {
    console.warn(`DarkFactory audit skipped ${repoName(TARGET_REPO)} because GitHub reports archived=${repo.archived === true} disabled=${repo.disabled === true}.`);
    return;
  }

  await ensureLabels(gh, TARGET_REPO, [...PLANNING_LABELS, ...WORK_LABELS]);
  const findings = [];
  const defaultBranch = repo.default_branch || "main";

  findings.push(...await auditGitState(TARGET_REPO, repo, defaultBranch));
  findings.push(...await auditHealth(TARGET_REPO, defaultBranch));
  findings.push(...await auditEnforcement(TARGET_REPO, defaultBranch));
  findings.push(...await auditPrdDrift(TARGET_REPO, defaultBranch));
  findings.push(...await auditDocStaleness(TARGET_REPO, repo, defaultBranch));

  const ledger = {
    trigger: TRIGGER,
    default_branch: defaultBranch,
    findings,
    actions: [],
    token_usage: {
      codex_calls: 0,
      input_tokens: 0,
      output_tokens: 0,
      note: "L5 audit used deterministic GitHub and repository metadata checks only"
    }
  };

  if (findings.length) {
    const issue = await upsertAuditIssue(TARGET_REPO, findings);
    ledger.actions.push({ action: "audit-findings-issue", issue, findings });
  } else {
    const closed = await closeResolvedAuditIssue(TARGET_REPO);
    if (closed) ledger.actions.push({ action: "close-resolved-audit", issue: closed });
  }

  await writeLedger(ledger);
  console.log(`DarkFactory audit completed ${findings.length} findings for ${repoName(TARGET_REPO)}.`);
}

async function auditGitState(repository, repo, defaultBranch) {
  const findings = [];
  if (!defaultBranch) findings.push(finding("git state", "Repository does not report a default branch."));
  if (repo.has_issues !== true) findings.push(finding("git state", "GitHub issues are disabled, so DarkFactory cannot file findings-as-issues."));
  const protection = await getBranchProtection(gh, repository, defaultBranch);
  if (!protection.configured) {
    findings.push(finding("git state", `Default branch \`${defaultBranch}\` does not have readable branch protection.`));
  }
  return findings;
}

async function auditHealth(repository, defaultBranch) {
  const findings = [];
  const runs = await listWorkflowRuns(repository, defaultBranch);
  const recentRuns = runs.filter((run) => run.status === "completed").slice(0, 10);
  const failing = recentRuns.filter((run) => !["success", "skipped", "neutral"].includes(run.conclusion || ""));
  if (recentRuns.length === 0) {
    findings.push(finding("health", `No completed GitHub Actions workflow runs were found on \`${defaultBranch}\`.`));
  }
  for (const run of failing.slice(0, 5)) {
    findings.push(finding("health", `Workflow \`${run.name || run.workflow_id}\` concluded \`${run.conclusion}\` on \`${defaultBranch}\`.`));
  }
  return findings;
}

async function auditEnforcement(repository, defaultBranch) {
  const findings = [];
  for (const filePath of REQUIRED_FILES) {
    const content = await getOptionalFileContent(gh, repository, filePath, defaultBranch);
    if (!content) findings.push(finding("enforcement conformance", `Required managed file \`${filePath}\` is missing on \`${defaultBranch}\`.`));
  }
  return findings;
}

async function auditPrdDrift(repository, defaultBranch) {
  const findings = [];
  const prd = await getOptionalFileContent(gh, repository, "PRD.md", defaultBranch);
  if (!prd) {
    findings.push(finding("PRD drift", `Root \`PRD.md\` is missing on \`${defaultBranch}\`.`));
    return findings;
  }

  const issues = await listIssues(gh, repository, "open");
  const hasPrdTrackedIssue = issues.some((issue) => !issue.pull_request && findPrdMarker(issue.body || ""));
  if (!hasPrdTrackedIssue && /\b(core loops|milestones)\b/i.test(prd)) {
    findings.push(finding("PRD drift", "PRD contains planned sections, but no open PRD-tracked backlog issues were found."));
  }
  return findings;
}

async function auditDocStaleness(repository, repo, defaultBranch) {
  const findings = [];
  const pushedAt = Date.parse(repo.pushed_at || "");
  if (!Number.isFinite(pushedAt)) return findings;

  for (const filePath of DOC_PATHS) {
    const commit = await getLatestCommitForPath(repository, filePath, defaultBranch);
    if (!commit) continue;
    const committedAt = Date.parse(commit.commit?.committer?.date || commit.commit?.author?.date || "");
    if (!Number.isFinite(committedAt)) continue;
    const ageDays = Math.floor((pushedAt - committedAt) / (24 * 60 * 60 * 1000));
    if (ageDays > DOC_STALE_DAYS) {
      findings.push(finding("doc staleness", `\`${filePath}\` is ${ageDays} days older than recent repository activity.`));
    }
  }
  return findings;
}

async function listWorkflowRuns(repository, branch) {
  try {
    const data = await gh.request(
      "GET",
      `/repos/${repoName(repository)}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=20`
    );
    return Array.isArray(data.workflow_runs) ? data.workflow_runs : [];
  } catch (error) {
    if (error.status === 403 || error.status === 404) {
      return [];
    }
    throw error;
  }
}

async function getLatestCommitForPath(repository, filePath, branch) {
  try {
    const data = await gh.request(
      "GET",
      `/repos/${repoName(repository)}/commits?sha=${encodeURIComponent(branch)}&path=${encodeURIComponent(filePath)}&per_page=1`
    );
    return Array.isArray(data) ? data[0] : null;
  } catch (error) {
    if (error.status === 404 || error.status === 409) return null;
    throw error;
  }
}

async function upsertAuditIssue(repository, findings) {
  const marker = `df-audit:${slug(repoName(repository))}`;
  const issues = await listIssues(gh, repository, "all");
  const existing = issues.find((issue) => findAuditMarker(issue.body || "") === marker);
  const body = auditIssueBody(repoName(repository), findings);
  const title = `Audit findings - ${repoName(repository)}`;

  if (existing) {
    const updated = await gh.request("PATCH", `/repos/${repoName(repository)}/issues/${existing.number}`, {
      title,
      body,
      state: "open"
    });
    await setAuditIssueLabels(repository, existing.number);
    return issueRef(updated);
  }

  const created = await gh.request("POST", `/repos/${repoName(repository)}/issues`, {
    title,
    body,
    labels: ["P1", "df:audit", "df:class:standard"]
  });
  return issueRef(created);
}

async function closeResolvedAuditIssue(repository) {
  const marker = `df-audit:${slug(repoName(repository))}`;
  const issues = await listIssues(gh, repository, "open");
  const existing = issues.find((issue) => findAuditMarker(issue.body || "") === marker);
  if (!existing) return null;
  await gh.request("POST", `/repos/${repoName(repository)}/issues/${existing.number}/comments`, {
    body: "DarkFactory L5 audit no longer detects this audit condition."
  });
  const closed = await gh.request("PATCH", `/repos/${repoName(repository)}/issues/${existing.number}`, { state: "closed" });
  return issueRef(closed);
}

async function setAuditIssueLabels(repository, issueNumber) {
  await gh.request("POST", `/repos/${repoName(repository)}/issues/${issueNumber}/labels`, {
    labels: ["P1", "df:audit", "df:class:standard"]
  });
}

async function writeLedger(ledger) {
  try {
    const written = await writeRunLedger(gh, DATA_REPO, "df-audit", repoName(TARGET_REPO), ledger);
    console.log(`DarkFactory ledger written to ${written.repository}/${written.path}`);
  } catch (error) {
    console.warn(`DarkFactory ledger warning: ${error.message || String(error)}`);
  }
}

function finding(category, message) {
  return { category, message };
}

function issueRef(issue) {
  return { number: issue.number, url: issue.html_url };
}
