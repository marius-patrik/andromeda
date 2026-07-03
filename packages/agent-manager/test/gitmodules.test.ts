import { describe, expect, test } from "bun:test";
import { parseGitmodules, serializeGitmodules } from "../src/gitmodules";

describe("gitmodules", () => {
  test("parses submodule entries", () => {
    expect(
      parseGitmodules(`[submodule "packages/agents/skyblock-agent"]
\tpath = packages/agents/skyblock-agent
\turl = https://github.com/marius-patrik/skyblock-agent.git
\tbranch = main
`),
    ).toEqual([
      {
        name: "packages/agents/skyblock-agent",
        path: "packages/agents/skyblock-agent",
        url: "https://github.com/marius-patrik/skyblock-agent.git",
        branch: "main",
      },
    ]);
  });

  test("serializes stable entries", () => {
    expect(
      serializeGitmodules([
        {
          name: "packages/harnesses/andromeda-harness",
          path: "packages/harnesses/andromeda-harness",
          url: "https://github.com/marius-patrik/andromeda-harness.git",
          branch: "main",
        },
      ]),
    ).toBe(`[submodule "packages/harnesses/andromeda-harness"]
\tpath = packages/harnesses/andromeda-harness
\turl = https://github.com/marius-patrik/andromeda-harness.git
\tbranch = main
`);
  });
});
