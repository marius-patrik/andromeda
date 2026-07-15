import assert from "node:assert/strict";
import test from "node:test";

import { convergeRepositorySettings, SetupOwnerActionRequired } from "../src/setup.js";

const repo = { owner: "marius-patrik", repo: "example" };
const labels = [{ name: "df:ready", color: "0E8A16", description: "Machine-evaluated" }];
const workflows = [".github/workflows/ci.yml"];

test("setup settings convergence is a proven no-op when repository state is healthy", async () => {
  const calls: Array<{ route: string; parameters: Record<string, unknown> }> = [];
  const github = requester(calls, (route, parameters) => {
    if (route === "GET /repos/{owner}/{repo}") return { default_branch: "main", allow_auto_merge: true, delete_branch_on_merge: true };
    if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}") return { object: { sha: parameters.ref === "heads/main" ? "main-sha" : "dev-sha" } };
    if (route === "GET /repos/{owner}/{repo}/labels") return [{ name: "df:ready", color: "0e8a16", description: "Machine-evaluated" }];
    if (route === "GET /repos/{owner}/{repo}/actions/workflows") return { workflows: [{ id: 1, path: workflows[0], state: "active" }] };
    if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") return protection();
    throw new Error(`unexpected ${route}`);
  });

  const receipts = await convergeRepositorySettings(github, repo, labels, workflows);
  assert.equal(receipts.every((receipt) => receipt.status === "current"), true);
  assert.equal(calls.some((call) => /^(POST|PATCH|PUT|DELETE) /.test(call.route)), false);
});

test("setup settings convergence repairs only deterministic settings and preserves safe protection fields", async () => {
  const calls: Array<{ route: string; parameters: Record<string, unknown> }> = [];
  const notFound = Object.assign(new Error("not found"), { status: 404 });
  const github = requester(calls, (route, parameters) => {
    if (route === "GET /repos/{owner}/{repo}") return { default_branch: "main", allow_auto_merge: false, delete_branch_on_merge: false };
    if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}") {
      if (parameters.ref === "heads/dev") throw notFound;
      return { object: { sha: "main-sha" } };
    }
    if (route === "GET /repos/{owner}/{repo}/labels") return [];
    if (route === "GET /repos/{owner}/{repo}/actions/workflows") return { workflows: [{ id: 2, path: workflows[0], state: "disabled_manually" }] };
    if (route === "GET /repos/{owner}/{repo}/branches/{branch}/protection") throw notFound;
    if (/^(POST|PATCH|PUT) /.test(route)) return {};
    throw new Error(`unexpected ${route}`);
  });

  const receipts = await convergeRepositorySettings(github, repo, labels, workflows);
  assert.ok(receipts.some((receipt) => receipt.action === "ensure-dev" && receipt.status === "applied"));
  assert.ok(calls.some((call) => call.route === "POST /repos/{owner}/{repo}/git/refs" && call.parameters.sha === "main-sha"));
  assert.ok(calls.some((call) => call.route === "PATCH /repos/{owner}/{repo}" && call.parameters.allow_auto_merge === true));
  const protections = calls.filter((call) => call.route === "PUT /repos/{owner}/{repo}/branches/{branch}/protection");
  assert.equal(protections.length, 2);
  assert.equal(protections.every((call) => call.parameters.enforce_admins === true && call.parameters.allow_force_pushes === false && call.parameters.allow_deletions === false), true);
});

test("setup settings convergence surfaces App permission gaps as owner actions", async () => {
  const forbidden = Object.assign(new Error("forbidden"), { status: 403 });
  const github = requester([], (route, parameters) => {
    if (route === "GET /repos/{owner}/{repo}") return { default_branch: "main", allow_auto_merge: false, delete_branch_on_merge: false };
    if (route === "GET /repos/{owner}/{repo}/git/ref/{ref}") return { object: { sha: parameters.ref === "heads/main" ? "main-sha" : "dev-sha" } };
    if (route === "PATCH /repos/{owner}/{repo}") throw forbidden;
    throw new Error(`unexpected ${route}`);
  });

  await assert.rejects(
    () => convergeRepositorySettings(github, repo, labels, workflows),
    (error: unknown) => error instanceof SetupOwnerActionRequired && error.action === "repository-automation"
  );
});

function requester(
  calls: Array<{ route: string; parameters: Record<string, unknown> }>,
  handle: (route: string, parameters: Record<string, unknown>) => unknown
) {
  return {
    async request(route: string, parameters: Record<string, unknown>) {
      calls.push({ route, parameters });
      return { data: handle(route, parameters) };
    }
  };
}

function protection() {
  return {
    required_status_checks: { strict: true, checks: [{ context: "Validate", app_id: 15368 }, { context: "Codex Review", app_id: 15368 }] },
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false }
  };
}
