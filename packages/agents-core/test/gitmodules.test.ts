import { describe, expect, test } from "bun:test";
import { parseGitmodules, serializeGitmodules } from "../src/gitmodules";

describe("gitmodules", () => {
  test("parses submodule entries", () => {
    expect(
      parseGitmodules(`[submodule "packages/skyblock-agent"]
\tpath = packages/skyblock-agent
\turl = https://github.com/marius-patrik/skyblock-agent.git
\tbranch = main
`),
    ).toEqual([
      {
        name: "packages/skyblock-agent",
        path: "packages/skyblock-agent",
        url: "https://github.com/marius-patrik/skyblock-agent.git",
        branch: "main",
      },
    ]);
  });

  test("serializes stable entries", () => {
    expect(
      serializeGitmodules([
        {
          name: "packages/rommie",
          path: "packages/rommie",
          url: "https://github.com/marius-patrik/andromeda.git",
          branch: "main",
        },
      ]),
    ).toBe(`[submodule "packages/rommie"]
\tpath = packages/rommie
\turl = https://github.com/marius-patrik/andromeda.git
\tbranch = main
`);
  });
});
