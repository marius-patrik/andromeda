import { describe, expect, test } from "bun:test";
import { parseGitmodules, serializeGitmodules } from "../src/gitmodules";

describe("gitmodules", () => {
  test("parses submodule entries", () => {
    expect(
      parseGitmodules(`[submodule "agents/skye"]
\tpath = agents/skye
\turl = https://github.com/marius-patrik/skye.git
\tbranch = main
`),
    ).toEqual([
      {
        name: "agents/skye",
        path: "agents/skye",
        url: "https://github.com/marius-patrik/skye.git",
        branch: "main",
      },
    ]);
  });

  test("serializes stable entries", () => {
    expect(
      serializeGitmodules([
        {
          name: "agents/rommie",
          path: "agents/rommie",
          url: "https://github.com/marius-patrik/andromeda.git",
          branch: "main",
        },
      ]),
    ).toBe(`[submodule "agents/rommie"]
\tpath = agents/rommie
\turl = https://github.com/marius-patrik/andromeda.git
\tbranch = main
`);
  });
});
