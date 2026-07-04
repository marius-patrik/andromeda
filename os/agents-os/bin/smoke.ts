#!/usr/bin/env bun
// Local smoke test for the agents-os image.
// Creates a throwaway shared-state directory, runs `agents state init` and
// `agents doctor` inside the container, then cleans up.
import path from "node:path";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const image = process.env.AGENTS_OS_IMAGE || "agents-os:dev";

async function run(command: string[], options?: { cwd?: string; env?: Record<string, string> }) {
  const proc = Bun.spawn(command, {
    cwd: options?.cwd,
    env: { ...process.env, ...options?.env },
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`command failed with ${code}: ${command.join(" ")}`);
}

async function main() {
  // Verify Docker is reachable before allocating temp state.
  try {
    await run(["docker", "version"]);
  } catch {
    throw new Error("docker is not available or not running");
  }

  const tmp = await mkdtemp(path.join(tmpdir(), "agents-os-smoke-"));
  const agentsDir = path.join(tmp, ".agents");
  const dataDir = path.join(tmp, "data-agentos");

  try {
    await mkdir(agentsDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });

    await run([
      "docker",
      "run",
      "--rm",
      "--label",
      "io.agents.os.managed=true",
      "--label",
      "io.agents.os.environment=smoke",
      "-v",
      `${agentsDir}:/agents/state`,
      "-v",
      `${dataDir}:/agents/data/agentos-data`,
      image,
      "bash",
      "-c",
      "agents state init && agents doctor",
    ]);

    console.log(`smoke ok: ${image}`);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`smoke failed: ${error.message}`);
  process.exit(1);
});
