#!/usr/bin/env bun
// Prune .gitmodules entries whose checkout paths do not exist in the image.
// This keeps `agents doctor` aligned with the actual distro contents.
import path from "node:path";
import { stat } from "node:fs/promises";
import { readGitmodules, writeGitmodules } from "../../agents-manager/src/gitmodules";

const root = process.argv[2] || "/opt/agents-os";
const gitmodulesPath = path.join(root, ".gitmodules");

const modules = await readGitmodules(gitmodulesPath);
const retained: typeof modules = [];

for (const mod of modules) {
  if (!mod.path) continue;
  const fullPath = path.resolve(root, mod.path);
  try {
    await stat(fullPath);
    retained.push(mod);
  } catch {
    // Skip missing checkouts so the image doctor only validates present layers.
  }
}

await writeGitmodules(gitmodulesPath, retained);
console.log(`filtered .gitmodules: ${retained.length}/${modules.length} entries retained`);
