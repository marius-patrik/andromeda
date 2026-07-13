// @ts-nocheck
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const doctor: any = await import("../.github/scripts/df-audit.mjs?unit=repository-doctor-test");

const repo = { owner: "marius-patrik", repo: "DarkFactory" };

function content(text: string) {
  return { type: "file", encoding: "base64", content: Buffer.from(text).toString("base64") };
}

function notFound(message = "not found") {
  return Object.assign(new Error(message), { status: 404 });
}

function mockGh(handler: (method: string, requestPath: string, body?: unknown) => unknown) {
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  return {
    calls,
    gh: {
      async request(method: string, requestPath: string, body?: unknown) {
        calls.push({ method, path: requestPath, body });
        return await handler(method, requestPath, body);
      }
    }
  };
}

function protectedBranch() {
  return {
    required_status_checks: { strict: true, checks: [{ context: "Validate", app_id: 15368 }, { context: "Codex Review", app_id: 15368 }] },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  };
}

test("doctor modes are explicit and repair is fail-closed", () => {
  assert.equal(doctor.parseDoctorMode("diagnose"), "diagnose");
  assert.equal(doctor.parseDoctorMode("report"), "report");
  assert.throws(() => doctor.parseDoctorMode("repair"), /repair mode is not implemented/i);
  assert.throws(() => doctor.parseDoctorMode("surprise"), /Unknown repository-doctor mode/);
});

test("stable findings deduplicate evidence and sort by id", () => {
  const findings = doctor.dedupeFindings([
    doctor.doctorFinding("z-last", "test", "last"),
    doctor.doctorFinding("a-first", "test", "first", { evidence: [{ label: "one", url: "https://example.test/1" }] }),
    doctor.doctorFinding("a-first", "test", "duplicate", { evidence: [{ label: "one", url: "https://example.test/1" }] })
  ]);
  assert.deepEqual(findings.map((finding) => finding.id), ["a-first", "z-last"]);
  assert.equal(findings[0].evidence.length, 1);
});

test("parseGitmodules preserves exact names, paths, urls, and branches", () => {
  assert.deepEqual(doctor.parseGitmodules(`[submodule "DarkFactory"]\n path = plugins/DarkFactory\n url = https://github.com/marius-patrik/DarkFactory.git\n branch = main\n`), [
    { name: "DarkFactory", path: "plugins/DarkFactory", url: "https://github.com/marius-patrik/DarkFactory.git", branch: "main" }
  ]);
  assert.deepEqual(doctor.parseGitmodules(""), []);
});

test("branch policy accepts protected identical main/dev and exempts active PR heads", async () => {
  const branches = [
    { name: "main", commit: { sha: "a" } },
    { name: "dev", commit: { sha: "a" } },
    { name: "feature/live", commit: { sha: "b" } }
  ];
  const pull = {
    number: 10,
    head: { ref: "feature/live", sha: "b", repo: { full_name: "marius-patrik/DarkFactory" } },
    base: { ref: "dev" }
  };
  const { gh } = mockGh((method, requestPath) => {
    if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
    if (requestPath.endsWith("/branches/main/protection") || requestPath.endsWith("/branches/dev/protection")) return protectedBranch();
    if (requestPath.endsWith("/pulls/10")) return { ...pull, updated_at: "2026-07-13T00:00:00Z", mergeable: true, mergeable_state: "clean", html_url: "https://github.com/marius-patrik/DarkFactory/pull/10" };
    if (requestPath.includes("/commits/b/check-runs")) return { check_runs: [{ name: "Validate", status: "completed", conclusion: "success" }] };
    if (requestPath.includes("/commits/b/status")) return { statuses: [] };
    throw new Error(`unexpected ${method} ${requestPath}`);
  });
  const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
    branches,
    branchNames: new Set(branches.map((branch) => branch.name)),
    pulls: [pull],
    isData: false,
    now: "2026-07-13T01:00:00Z"
  });
  assert.deepEqual(result.findings, []);
});

test("an open PR exempts only the exact same-repository branch head SHA", async () => {
  const branches = [
    { name: "main", commit: { sha: "a" } },
    { name: "dev", commit: { sha: "a" } },
    { name: "feature/moved", commit: { sha: "new-head" } }
  ];
  const pull = {
    number: 11,
    head: { ref: "feature/moved", sha: "stale-pr-head", repo: { full_name: "marius-patrik/DarkFactory" } },
    base: { ref: "dev" }
  };
  const { gh } = mockGh((_method, requestPath) => {
    if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
    if (requestPath.includes("/protection")) return protectedBranch();
    if (requestPath.endsWith("/pulls/11")) return { ...pull, updated_at: "2026-07-13T00:00:00Z", mergeable: true, mergeable_state: "clean", html_url: "https://example.test/11" };
    if (requestPath.includes("/commits/stale-pr-head/check-runs")) return { check_runs: [{ name: "Validate", status: "completed", conclusion: "success" }] };
    if (requestPath.includes("/commits/stale-pr-head/status")) return { statuses: [] };
    throw new Error(`unexpected ${requestPath}`);
  });
  const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
    branches, branchNames: new Set(branches.map((branch) => branch.name)), pulls: [pull], isData: false, now: "2026-07-13T01:00:00Z"
  });
  assert.ok(result.findings.some((finding) => finding.id === "extra-branch-feature-moved"));
});

test("branch policy classifies behind, diverged, missing, and main-only data repositories", async () => {
  for (const status of ["behind", "diverged"]) {
    const branches = [{ name: "main", commit: { sha: "a" } }, { name: "dev", commit: { sha: "b" } }];
    const { gh } = mockGh((_method, requestPath) => {
      if (requestPath.endsWith("/compare/main...dev")) return { status, ahead_by: 1, behind_by: 1 };
      if (requestPath.includes("/protection")) return protectedBranch();
      throw new Error(`unexpected ${requestPath}`);
    });
    const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
      branches, branchNames: new Set(["main", "dev"]), pulls: [], isData: false
    });
    assert.ok(result.findings.some((finding) => finding.id === (status === "behind" ? "dev-behind-main" : "main-dev-diverged")));
  }

  const { gh: missingGh } = mockGh((_method, requestPath) => requestPath.includes("/protection") ? protectedBranch() : (() => { throw new Error(`unexpected ${requestPath}`); })());
  const missing = await doctor.auditBranchAndReleaseState(missingGh, repo, { default_branch: "main", allow_auto_merge: true }, {
    branches: [{ name: "main", commit: { sha: "a" } }], branchNames: new Set(["main"]), pulls: [], isData: false
  });
  assert.ok(missing.findings.some((finding) => finding.id === "dev-branch-missing"));

  const dataRepo = { owner: "marius-patrik", repo: "Andromeda-data" };
  const { gh: dataGh } = mockGh((_method, requestPath) => requestPath.includes("/protection") ? (() => { throw notFound(); })() : (() => { throw new Error(`unexpected ${requestPath}`); })());
  const data = await doctor.auditBranchAndReleaseState(dataGh, dataRepo, { default_branch: "main", allow_auto_merge: false }, {
    branches: [{ name: "main", commit: { sha: "a" } }], branchNames: new Set(["main"]), pulls: [], isData: true
  });
  assert.equal(data.findings.some((finding) => /dev|automerge/.test(finding.id)), false);
});

test("branch protection reports each missing or unsafe gate", async () => {
  const { gh } = mockGh(() => ({ required_status_checks: { strict: true, contexts: [] }, enforce_admins: { enabled: true }, allow_force_pushes: { enabled: true }, allow_deletions: { enabled: true } }));
  const findings = await doctor.auditBranchProtection(gh, repo, "main", { required: true });
  assert.deepEqual(new Set(findings.map((finding) => finding.id)), new Set([
    "protection-main-validate-missing",
    "protection-main-review-missing",
    "protection-main-force-push",
    "protection-main-deletion"
  ]));
});

test("branch protection requires exact app-bound gates, strict updates, and admin enforcement", async () => {
  const { gh } = mockGh(() => ({
    required_status_checks: { strict: false, checks: [{ context: "CI", app_id: 1 }, { context: "Autoreview lint", app_id: 1 }] },
    enforce_admins: { enabled: false },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  }));
  const findings = await doctor.auditBranchProtection(gh, repo, "main", { required: true });
  const ids = new Set(findings.map((finding) => finding.id));
  assert.ok(ids.has("protection-main-validate-missing"));
  assert.ok(ids.has("protection-main-review-missing"));
  assert.ok(ids.has("protection-main-strict-missing"));
  assert.ok(ids.has("protection-main-admin-bypass"));
});

test("branch protection fails closed on unbound and malformed required-check payloads", async () => {
  const { gh: unboundGh } = mockGh(() => ({
    required_status_checks: { strict: true, contexts: ["Validate", "Codex Review"] },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  }));
  const unbound = await doctor.auditBranchProtection(unboundGh, repo, "dev", { required: true });
  assert.ok(unbound.some((finding) => finding.id === "protection-dev-validate-app-unbound"));
  assert.ok(unbound.some((finding) => finding.id === "protection-dev-codex-review-app-unbound"));

  const { gh: wrongAppGh } = mockGh(() => ({
    required_status_checks: { strict: true, checks: [{ context: "Validate", app_id: 99999 }, { context: "DarkFactory Autoreview", app_id: 99999 }] },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  }));
  const observations: string[] = [];
  const wrongApp = await doctor.auditBranchProtection(wrongAppGh, repo, "dev", { required: true, observations });
  assert.ok(wrongApp.some((finding) => finding.id === "protection-dev-validate-app-mismatch" && /99999.*15368/.test(finding.message)));
  assert.ok(wrongApp.some((finding) => finding.id === "protection-dev-darkfactory-autoreview-app-mismatch"));
  assert.match(observations[0], /Validate@app:99999.*DarkFactory Autoreview@app:99999/);

  const { gh: malformedGh } = mockGh(() => ({ required_status_checks: { strict: true, checks: "invalid" } }));
  const malformed = await doctor.auditBranchProtection(malformedGh, repo, "dev", { required: true });
  const ids = new Set(malformed.map((finding) => finding.id));
  assert.ok(ids.has("protection-dev-required-checks-malformed"));
  assert.ok(ids.has("protection-dev-admin-bypass-unobservable"));
  assert.ok(ids.has("protection-dev-force-push-unobservable"));
  assert.ok(ids.has("protection-dev-deletion-unobservable"));
});

test("branch protection distinguishes inaccessible 403 state from absent 404 state", async () => {
  for (const [status, expected] of [[403, "protection-dev-unobservable"], [404, "protection-dev-missing"]]) {
    const { gh } = mockGh(() => { throw Object.assign(new Error(`HTTP ${status}`), { status }); });
    const findings = await doctor.auditBranchProtection(gh, repo, "dev", { required: true });
    assert.equal(findings[0].id, expected);
    if (status === 403) assert.match(findings[0].message, /unknown, not absent/);
  }
});

test("main-only data repositories do not inherit product gate requirements", async () => {
  const { gh } = mockGh(() => ({
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  }));
  const findings = await doctor.auditBranchProtection(gh, { owner: "marius-patrik", repo: "Andromeda-data" }, "main", { required: false });
  assert.deepEqual(findings, []);
});

test("the #241 shape remains diagnosed while its active head branch is exempt", async () => {
  const branches = [{ name: "main", commit: { sha: "a" } }, { name: "dev", commit: { sha: "a" } }, { name: "dark-factory/managed-repository-setup", commit: { sha: "b" } }];
  const pull = { number: 241, head: { ref: "dark-factory/managed-repository-setup", sha: "b", repo: { full_name: "marius-patrik/DarkFactory" } }, base: { ref: "main" } };
  const { gh } = mockGh((_method, requestPath) => {
    if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
    if (requestPath.includes("/protection")) return protectedBranch();
    if (requestPath.endsWith("/pulls/241")) return { ...pull, updated_at: "2026-07-01T00:00:00Z", mergeable: false, mergeable_state: "dirty", html_url: "https://github.com/marius-patrik/DarkFactory/pull/241" };
    if (requestPath.includes("/commits/b/check-runs")) return { check_runs: [{ name: "Validate", status: "completed", conclusion: "failure", html_url: "https://example.test/validate" }, { name: "Codex Review", status: "completed", conclusion: "failure" }] };
    if (requestPath.includes("/commits/b/status")) return { statuses: [] };
    throw new Error(`unexpected ${requestPath}`);
  });
  const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
    branches, branchNames: new Set(branches.map((branch) => branch.name)), pulls: [pull], isData: false, now: "2026-07-13T00:00:00Z"
  });
  assert.ok(result.findings.some((finding) => finding.id === "pr-241-red"));
  assert.ok(result.findings.some((finding) => finding.id === "pr-241-not-mergeable"));
  assert.equal(result.findings.some((finding) => finding.id.includes("extra-branch-dark-factory")), false);
});

test("unknown completed check conclusions and malformed check payloads never become healthy", async () => {
  for (const checkRuns of [
    { check_runs: [{ name: "Validate", status: "completed", conclusion: "mystery" }] },
    { check_runs: "malformed" }
  ]) {
    const branches = [{ name: "main", commit: { sha: "a" } }, { name: "dev", commit: { sha: "a" } }];
    const pull = { number: 77, head: { ref: "feature/check", sha: "c", repo: { full_name: "marius-patrik/DarkFactory" } }, base: { ref: "dev" } };
    const { gh } = mockGh((_method, requestPath) => {
      if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
      if (requestPath.includes("/protection")) return protectedBranch();
      if (requestPath.endsWith("/pulls/77")) return { ...pull, updated_at: "2026-07-13T00:00:00Z", mergeable: true, mergeable_state: "clean", html_url: "https://example.test/77" };
      if (requestPath.includes("/commits/c/check-runs")) return checkRuns;
      if (requestPath.includes("/commits/c/status")) return { statuses: [] };
      throw new Error(`unexpected ${requestPath}`);
    });
    const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
      branches, branchNames: new Set(["main", "dev"]), pulls: [pull], isData: false, now: "2026-07-13T01:00:00Z"
    });
    assert.ok(result.findings.some((finding) => finding.id === "pr-77-checks-unobservable"));
  }
});

test("inaccessible and individually malformed check evidence fails closed", async () => {
  for (const variant of ["inaccessible", "missing-name", "missing-context"]) {
    const branches = [{ name: "main", commit: { sha: "a" } }, { name: "dev", commit: { sha: "a" } }];
    const pull = { number: 78, head: { ref: "feature/check", sha: "d", repo: { full_name: "marius-patrik/DarkFactory" } }, base: { ref: "dev" } };
    const { gh } = mockGh((_method, requestPath) => {
      if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
      if (requestPath.includes("/protection")) return protectedBranch();
      if (requestPath.endsWith("/pulls/78")) return { ...pull, updated_at: "2026-07-13T00:00:00Z", mergeable: true, mergeable_state: "clean", html_url: "https://example.test/78" };
      if (requestPath.includes("/commits/d/check-runs")) {
        if (variant === "inaccessible") throw Object.assign(new Error("forbidden"), { status: 403 });
        return { check_runs: [{ ...(variant === "missing-name" ? {} : { name: "Validate" }), status: "completed", conclusion: "success" }] };
      }
      if (requestPath.includes("/commits/d/status")) {
        return variant === "missing-context"
          ? { statuses: [{ state: "success" }] }
          : { statuses: [] };
      }
      throw new Error(`unexpected ${requestPath}`);
    });
    const result = await doctor.auditBranchAndReleaseState(gh, repo, { default_branch: "main", allow_auto_merge: true }, {
      branches, branchNames: new Set(["main", "dev"]), pulls: [pull], isData: false, now: "2026-07-13T01:00:00Z"
    });
    assert.ok(result.findings.some((finding) => finding.id === "pr-78-checks-unobservable"), variant);
  }
});

test("issue lane catches duplicate markers, stale blockers, missing blockers, self-reference, and cycles", () => {
  const issues = [
    { number: 1, state: "open", title: "One", body: "<!-- darkfactory:model -->\nBlocked-by: #2", updated_at: "2026-07-13T00:00:00Z", html_url: "https://example.test/1" },
    { number: 2, state: "open", title: "Two", body: "<!-- darkfactory:model -->\nBlocked-by: #1", updated_at: "2026-07-13T00:00:00Z", html_url: "https://example.test/2" },
    { number: 3, state: "open", title: "Three", body: "Blocked-by: #3, #9, #4", updated_at: "2026-07-13T00:00:00Z", html_url: "https://example.test/3" },
    { number: 4, state: "closed", title: "Done", body: "", updated_at: "2026-07-12T00:00:00Z", html_url: "https://example.test/4" }
  ];
  const findings = doctor.auditIssueLane(repo, issues, { now: "2026-07-13T01:00:00Z" });
  const ids = new Set(findings.map((finding) => finding.id));
  assert.ok(ids.has("duplicate-issue-marker-darkfactory-model"));
  assert.ok(ids.has("issue-3-blocker-self-reference"));
  assert.ok(ids.has("issue-3-blocker-9-missing"));
  assert.ok(ids.has("issue-3-blocker-4-satisfied"));
  assert.ok(ids.has("issue-blocker-cycle-1-2"));
});

test("issue lane does not treat historical prose as an active supersession declaration", () => {
  const findings = doctor.auditIssueLane(repo, [{
    number: 11,
    state: "open",
    title: "Current contract",
    body: "Historical comments are superseded by #35, but this issue remains current.",
    updated_at: "2026-07-13T00:00:00Z"
  }], { now: "2026-07-13T01:00:00Z" });
  assert.equal(findings.some((finding) => finding.id === "superseded-issue-11-open"), false);
});

test("untrusted issue text cannot claim a doctor-owned marker", () => {
  const issue = {
    number: 99,
    state: "open",
    title: "spoof",
    body: "<!-- df-doctor:marius-patrik-darkfactory:fake -->",
    user: { login: "untrusted-user" },
    updated_at: "2026-07-13T00:00:00Z",
    html_url: "https://example.test/99"
  };
  const findings = doctor.auditIssueLane(repo, [issue], { now: "2026-07-13T01:00:00Z" });
  assert.ok(findings.some((finding) => finding.id === "untrusted-doctor-marker-99"));
  assert.equal(doctor.isTrustedDoctorIssue(issue), false);
});

test("repository tree permits root policy authority but rejects nested copies", async () => {
  const findings = await doctor.auditRepositoryTree(repo, {
    truncated: false,
    tree: [
      { path: ".agents", type: "tree" },
      { path: ".agents/.project", type: "tree" },
      { path: ".agents/.project/STATUS.md", type: "blob" },
      { path: ".darkfactory", type: "tree" },
      { path: ".darkfactory/branching-policy.md", type: "blob" },
      { path: "packages/example/.agents/private.json", type: "blob" }
    ]
  });
  assert.deepEqual(findings.map((finding) => finding.id), ["state-boundary-packages-example-agents-private-json"]);
});

test("worker session isolation reads canonical state and catches escaped cwd", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "df-doctor-sessions-"));
  try {
    for (const [id, workdir] of [["good", path.join(tmpdir(), "df-work-good", "repo")], ["bad", "C:\\Users\\patrik\\marius-patrik\\Andromeda"]]) {
      const session = path.join(root, "sessions", id);
      await mkdir(session, { recursive: true });
      await writeFile(path.join(session, "state.json"), JSON.stringify({ sessionId: id, workdir, lastTurnAt: "2026-07-13T00:00:00Z" }));
      await writeFile(path.join(session, "transcript.json"), JSON.stringify({ messages: [{ role: "user", content: "Read .darkfactory/df-task-brief.md and implement that task in the current repository. Continue safely." }] }));
    }
    const result = doctor.auditWorkerSessionIsolation(root, { now: "2026-07-13T01:00:00Z" });
    assert.equal(result.findings.length, 1);
    assert.equal(result.findings[0].id, "worker-session-workdir-isolation");
    assert.match(result.findings[0].message, /bad/);
    assert.doesNotMatch(result.findings[0].message, /good/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("diagnose mode performs no GitHub writes", async () => {
  const { gh, calls } = mockGh((method, requestPath) => {
    if (method !== "GET") throw new Error(`unexpected write ${method} ${requestPath}`);
    if (requestPath === "/repos/marius-patrik/DarkFactory") return { default_branch: "main", allow_auto_merge: true, archived: false, disabled: false, pushed_at: "2026-07-13T00:00:00Z" };
    if (requestPath.includes("/branches?")) return requestPath.endsWith("page=1") ? [{ name: "main", commit: { sha: "a" } }, { name: "dev", commit: { sha: "a" } }] : [];
    if (requestPath.includes("/pulls?state=open")) return [];
    if (requestPath.includes("/issues?state=all")) return [];
    if (requestPath.endsWith("/git/trees/main?recursive=1")) return { truncated: false, tree: [{ path: "README.md", type: "blob" }] };
    if (requestPath.endsWith("/compare/main...dev")) return { status: "identical", ahead_by: 0, behind_by: 0 };
    if (requestPath.includes("/protection")) return protectedBranch();
    if (requestPath.includes("/actions/secrets")) return { secrets: [] };
    if (requestPath.includes("/actions/runners")) return { runners: [{ status: "online", labels: [{ name: "df-local" }] }] };
    if (requestPath.includes("/actions/runs?")) return { workflow_runs: [{ name: "Validate", status: "completed", conclusion: "success" }] };
    if (requestPath.includes("/commits?sha=")) return [];
    if (requestPath.includes("/contents/.github/workflows/df-work.yml")) return content("AGENTS_HOME bin\\agents.ps1 state doctor --json");
    if (requestPath.includes("/contents/AGENTS.md")) return content("Use AGENTS_HOME.");
    if (requestPath.includes("/contents/README.md")) return content("# DarkFactory\n");
    if (requestPath.includes("/contents/package.json")) return content('{"name":"@agent-os/darkfactory"}');
    if (requestPath.includes("/contents/PRD.md")) return content("# PRD\n");
    if (requestPath.includes("/contents/.darkfactory/enforcement-rules.json")) return content('{"rules":[{"id":"no-admin-bypass","enabled":true,"severity":"block"}]}');
    if (requestPath.includes("/contents/.darkfactory/") || requestPath.includes("/contents/.gitmodules") || requestPath.includes("/contents/.github/workflows/sync-managed-repos.yml") || requestPath.includes("/contents/.agents/") || requestPath.includes("/contents/src/managed-files.ts")) throw notFound();
    throw new Error(`unexpected ${method} ${requestPath}`);
  });
  const reports = await doctor.runRepositoryDoctor(gh, {
    mode: "diagnose",
    trigger: "test",
    controlRepo: repo,
    target: repo,
    registry: { schemaVersion: 1, repositories: { "marius-patrik/DarkFactory": { state: "active" } } }
  });
  assert.equal(reports[0].read_only, true);
  assert.equal(reports[0].trigger, "test");
  assert.equal(calls.every((call) => call.method === "GET"), true);
});

test("report issue reconciliation is marker-idempotent and closes resolved findings", async () => {
  const current = doctor.doctorFinding("current-drift", "branch policy", "current");
  const existing = { number: 7, state: "open", body: "<!-- df-doctor:marius-patrik-darkfactory:current-drift -->", user: { login: "mp-agents[bot]" }, html_url: "https://example.test/7" };
  const resolved = { number: 8, state: "open", body: "<!-- df-doctor:marius-patrik-darkfactory:old-drift -->", user: { login: "mp-agents[bot]" }, html_url: "https://example.test/8" };
  const { gh, calls } = mockGh((method, requestPath) => {
    if (method === "GET" && requestPath.includes("issues?state=all") && requestPath.endsWith("page=1")) return [existing, resolved];
    if (method === "GET" && requestPath.includes("issues?state=all") && requestPath.endsWith("page=2")) return [];
    if (method === "PATCH" || method === "POST") return {};
    throw new Error(`unexpected ${method} ${requestPath}`);
  });
  const actions = await doctor.reconcileDoctorIssues(gh, repo, [current]);
  assert.equal(calls.some((call) => call.method === "POST" && call.path === "/repos/marius-patrik/DarkFactory/issues"), false);
  assert.ok(actions.some((action) => action.action === "update-repair-issue"));
  assert.ok(actions.some((action) => action.action === "close-resolved-repair-issue"));
});

test("doctor issue sources are unambiguous across repositories", () => {
  const body = doctor.doctorIssueBody("marius-patrik/Andromeda", doctor.doctorFinding("drift", "policy", "observed", { severity: "critical" }));
  assert.match(body, /Priority: `P0`/);
  assert.match(body, /\[marius-patrik\/DarkFactory#12\]\(https:\/\/github\.com\/marius-patrik\/DarkFactory\/issues\/12\)/);
  assert.match(body, /\[marius-patrik\/DarkFactory#35\]\(https:\/\/github\.com\/marius-patrik\/DarkFactory\/issues\/35\)/);
  assert.doesNotMatch(body, /foundation: #12|epic: #35/);
  assert.deepEqual(doctor.DOCTOR_REPORT_LABELS.map((label) => label.name).sort(), ["P0", "P1", "P2", "df:class:mechanical", "df:doctor"]);
});

test("live DarkFactory App actor creates, updates, then closes one stable issue across consecutive reports", async () => {
  const issues: any[] = [];
  const calls: any[] = [];
  const gh = {
    async request(method: string, requestPath: string, body?: any) {
      calls.push({ method, path: requestPath, body });
      if (method === "GET" && requestPath.includes("issues?state=all")) return issues.map((issue) => ({ ...issue }));
      if (method === "POST" && requestPath === "/repos/marius-patrik/DarkFactory/issues") {
        const issue = {
          number: 10,
          state: "open",
          title: body.title,
          body: body.body,
          labels: body.labels,
          user: { login: "darkfactory-agent[bot]" },
          html_url: "https://example.test/10"
        };
        issues.push(issue);
        return { ...issue };
      }
      if (method === "PATCH" && requestPath === "/repos/marius-patrik/DarkFactory/issues/10") {
        Object.assign(issues[0], body);
        return { ...issues[0] };
      }
      if (method === "POST" && requestPath === "/repos/marius-patrik/DarkFactory/issues/10/comments") return {};
      throw new Error(`unexpected ${method} ${requestPath}`);
    }
  };
  const finding = doctor.doctorFinding("stable-live-actor", "health", "observed");

  const created = await doctor.reconcileDoctorIssues(gh, repo, [finding]);
  assert.deepEqual(created.map((action) => action.action), ["create-repair-issue"]);
  assert.equal(doctor.isTrustedDoctorIssue(issues[0]), true);

  const updated = await doctor.reconcileDoctorIssues(gh, repo, [finding]);
  assert.deepEqual(updated.map((action) => action.action), ["update-repair-issue"]);
  assert.equal(issues.length, 1);

  const closed = await doctor.reconcileDoctorIssues(gh, repo, []);
  assert.deepEqual(closed.map((action) => action.action), ["close-resolved-repair-issue"]);
  assert.equal(issues[0].state, "closed");
  assert.equal(calls.filter((call) => call.method === "POST" && call.path === "/repos/marius-patrik/DarkFactory/issues").length, 1);
});

test("human and JSON formats preserve deterministic zero-token evidence", () => {
  const reports = [{ target_repository: "marius-patrik/DarkFactory", mode: "diagnose", read_only: true, findings: [], observations: ["checked"], token_usage: { model_calls: 0 } }];
  assert.match(doctor.formatDoctorReports(reports), /HEALTHY \(diagnose, read_only=true\)/);
  assert.equal(JSON.parse(JSON.stringify(reports))[0].token_usage.model_calls, 0);
});
