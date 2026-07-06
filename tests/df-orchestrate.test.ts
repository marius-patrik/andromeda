import assert from "node:assert/strict";
import test from "node:test";

test("orchestrator dispatches open df:ready issues in active managed repos", async () => {
  // @ts-ignore Script helpers are native ESM workflow files, not built TypeScript modules.
  const { orchestrate } = await import("../.github/scripts/df-orchestrate.mjs?unit=df-orchestrate-test");
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const notFound = Object.assign(new Error("not found"), { status: 404 });

  const gh = {
    async graphql() {
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: []
          }
        }
      };
    },
    async request(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body });

      if (method === "GET" && path === "/repos/marius-patrik/example/issues?state=open&per_page=100&page=1") {
        return [
          {
            number: 42,
            body: "Directly queued issue without a PRD marker.",
            labels: [{ name: "df:ready" }]
          }
        ];
      }
      if (method === "GET" && path === "/repos/marius-patrik/example/issues?state=open&per_page=100&page=2") {
        return [];
      }
      if (method === "GET" && path === "/repos/marius-patrik/example") {
        return { default_branch: "main", allow_auto_merge: true };
      }
      if (method === "GET" && path === "/repos/marius-patrik/example/git/ref/heads/dev") {
        throw notFound;
      }
      if (method === "GET" && path === "/repos/marius-patrik/example/branches/main/protection") {
        throw notFound;
      }
      if (method === "POST" && path === "/repos/marius-patrik/example/issues/42/labels") {
        return {};
      }
      if (method === "DELETE" && path === "/repos/marius-patrik/example/issues/42/labels/df%3Aready") {
        return null;
      }
      if (method === "POST" && path === "/repos/marius-patrik/agent-darkfactory/actions/workflows/df-work.yml/dispatches") {
        return null;
      }

      throw new Error(`Unexpected GitHub request: ${method} ${path}`);
    }
  };

  const result = await orchestrate({
    gh,
    controlRepo: { owner: "marius-patrik", repo: "agent-darkfactory" },
    registry: { repositories: { "marius-patrik/example": { state: "active" } } },
    repositories: [{ full_name: "marius-patrik/example", archived: false, disabled: false }],
    writeLedger: false,
    warn: () => {},
    log: () => {}
  });

  assert.deepEqual(result.dispatched, [{ repo: "marius-patrik/example", issue: 42 }]);
  assert.deepEqual(
    calls.find((call) => call.method === "POST" && call.path === "/repos/marius-patrik/example/issues/42/labels")?.body,
    { labels: ["df:running"] }
  );
  assert.ok(calls.some((call) => call.method === "DELETE" && call.path === "/repos/marius-patrik/example/issues/42/labels/df%3Aready"));
  assert.deepEqual(
    calls.find((call) => call.method === "POST" && call.path.endsWith("/actions/workflows/df-work.yml/dispatches"))?.body,
    { ref: "main", inputs: { repo: "marius-patrik/example", issue_number: "42" } }
  );
});

test("orchestrator does not dispatch issues that already have an open worker PR", async () => {
  // @ts-ignore Script helpers are native ESM workflow files, not built TypeScript modules.
  const { orchestrate } = await import("../.github/scripts/df-orchestrate.mjs?unit=df-orchestrate-existing-pr-test");
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];

  const gh = {
    async graphql() {
      return {
        repository: {
          pullRequests: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "PR_21",
                number: 21,
                title: "Worker PR",
                body: "<!-- dark-factory:worker-pr issue=8 -->\n\nCloses #8",
                url: "https://github.com/marius-patrik/example/pull/21",
                headRefName: "df/8-worker",
                baseRefName: "main",
                headRepository: { owner: { login: "marius-patrik" }, name: "example" },
                author: { login: "mp-agents[bot]" }
              }
            ]
          }
        }
      };
    },
    async request(method: string, path: string, body?: unknown) {
      calls.push({ method, path, body });

      if (method === "GET" && path === "/repos/marius-patrik/example/issues?state=open&per_page=100&page=1") {
        return [{ number: 8, labels: [{ name: "df:ready" }] }];
      }
      if (method === "GET" && path === "/repos/marius-patrik/example/issues?state=open&per_page=100&page=2") {
        return [];
      }
      if (method === "POST" && path === "/repos/marius-patrik/example/issues/8/labels") return {};
      if (method === "DELETE" && path === "/repos/marius-patrik/example/issues/8/labels/df%3Aready") return {};

      throw new Error(`Unexpected GitHub request: ${method} ${path}`);
    }
  };

  const result = await orchestrate({
    gh,
    controlRepo: { owner: "marius-patrik", repo: "agent-darkfactory" },
    registry: { repositories: { "marius-patrik/example": { state: "active" } } },
    repositories: [{ full_name: "marius-patrik/example", archived: false, disabled: false }],
    writeLedger: false,
    warn: () => {},
    log: () => {}
  });

  assert.deepEqual(result.dispatched, []);
  assert.equal(calls.some((call) => call.path.endsWith("/actions/workflows/df-work.yml/dispatches")), false);
  assert.deepEqual(
    calls.find((call) => call.method === "POST" && call.path === "/repos/marius-patrik/example/issues/8/labels")?.body,
    { labels: ["df:running"] }
  );
  assert.ok(calls.some((call) => call.method === "DELETE" && call.path === "/repos/marius-patrik/example/issues/8/labels/df%3Aready"));
});

test("orchestrator selects next ready issues by priority, blocked-by, and stream lane", async () => {
  // @ts-ignore Script helpers are native ESM workflow files, not built TypeScript modules.
  const { blockedByIssueNumbers, selectDispatchableIssues } = await import("../.github/scripts/df-orchestrate.mjs?unit=df-orchestrate-scheduler-test");

  assert.deepEqual(blockedByIssueNumbers("Blocked-by: #61, #63\nBlocked-by: owner/repo#70"), [61, 63, 70]);
  assert.equal(Number.isNaN(blockedByIssueNumbers("Blocked-by: waiting for owner")[0]), true);

  const selected = selectDispatchableIssues([
    {
      number: 10,
      body: "",
      labels: [{ name: "df:ready" }, { name: "P2" }, { name: "stream:docs" }]
    },
    {
      number: 11,
      body: "## Sequencing\n\nBlocked-by: #9",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:core" }]
    },
    {
      number: 9,
      body: "",
      labels: [{ name: "df:running" }, { name: "stream:core" }]
    },
    {
      number: 12,
      body: "",
      labels: [{ name: "df:ready" }, { name: "P1" }, { name: "stream:docs" }]
    },
    {
      number: 13,
      body: "",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:ui" }]
    },
    {
      number: 14,
      body: "Blocked-by: #99",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:api" }]
    },
    {
      number: 15,
      body: "Blocked-by: #99, #12",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:ops" }]
    },
    {
      number: 16,
      body: "Blocked-by: owner/repo#99, owner/repo#98",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:review" }]
    },
    {
      number: 17,
      body: "Blocked-by: waiting for owner",
      labels: [{ name: "df:ready" }, { name: "P0" }, { name: "stream:unsafe" }]
    }
  ]);

  assert.deepEqual(
    selected.map((issue: { number: number }) => issue.number),
    [13, 14, 16, 12]
  );
});
