#!/usr/bin/env bun
import path from "node:path";
import { cp, mkdir, stat } from "node:fs/promises";
import { readGitmodules, writeGitmodules } from "./gitmodules";
import { ensureSharedState, readInstalls, sharedState, writeInstalls, type InstallKind } from "./state";

const root = process.cwd();
const gitmodulesPath = path.join(root, ".gitmodules");
const packageKinds = new Map([
  ["agent", "agents"],
  ["cli", "clis"],
  ["private", "private"],
]);

function help(): void {
  console.log(`agents - Bun agent package manager

Usage:
  agents list [--json]
  agents info <name-or-path> [--json]
  agents add <name> <git-url> [--kind agent|cli|private] [--branch main] [--path path]
  agents remove <name-or-path>
  agents sync
  agents state init
  agents state env
  agents install <skill|plugin|cli> <name> <source-path-or-url>
  agents installs [--json]
  agents credits [--json]
  agents doctor

All runtime data is shared through .agents so every managed CLI sees the same
skills, plugins, CLI metadata, and credit store.`);
}

function parseArgs(args: string[]): { values: string[]; flags: Record<string, string | boolean> } {
  const values: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      values.push(arg);
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2);
    if (inline !== undefined) flags[key] = inline;
    else if (args[index + 1] && !args[index + 1].startsWith("--")) flags[key] = args[++index];
    else flags[key] = true;
  }
  return { values, flags };
}

async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch {
    return false;
  }
}

function inferKind(packagePath: string): string {
  const first = packagePath.split(/[\\/]/)[0];
  if (first === "agents") return "agent";
  if (first === "clis") return "cli";
  if (first === "private") return "private";
  return "package";
}

async function manifest(packagePath: string): Promise<Record<string, unknown> | null> {
  const file = path.join(root, packagePath, "agent.json");
  if (!(await exists(file))) return null;
  return JSON.parse(await Bun.file(file).text()) as Record<string, unknown>;
}

async function packages() {
  return Promise.all(
    (await readGitmodules(gitmodulesPath)).map(async (mod) => ({
      ...mod,
      kind: inferKind(mod.path ?? mod.name),
      manifest: mod.path ? await manifest(mod.path) : null,
    })),
  );
}

async function list(flags: Record<string, string | boolean>): Promise<void> {
  const loaded = await packages();
  if (flags.json) console.log(JSON.stringify(loaded, null, 2));
  else for (const item of loaded) console.log(`${item.name.padEnd(28)} ${item.kind.padEnd(8)} ${item.path}`);
}

async function info(query: string | undefined, flags: Record<string, string | boolean>): Promise<void> {
  if (!query) throw new Error("info requires a package name or path");
  const item = (await packages()).find((pkg) => {
    const manifestName = typeof pkg.manifest?.name === "string" ? pkg.manifest.name : undefined;
    return pkg.name === query || pkg.path === query || path.basename(pkg.path ?? "") === query || manifestName === query;
  });
  if (!item) throw new Error(`package not found: ${query}`);
  if (flags.json) console.log(JSON.stringify(item, null, 2));
  else {
    console.log(item.name);
    console.log(`  kind:   ${item.kind}`);
    console.log(`  path:   ${item.path}`);
    console.log(`  url:    ${item.url}`);
    console.log(`  branch: ${item.branch ?? "(default)"}`);
  }
}

async function add(values: string[], flags: Record<string, string | boolean>): Promise<void> {
  const [name, url] = values;
  if (!name || !url) throw new Error("add requires a package name and git URL");
  const kind = String(flags.kind ?? "agent");
  const base = packageKinds.get(kind);
  if (!base) throw new Error(`unsupported package kind: ${kind}`);
  const packagePath = String(flags.path ?? (kind === "private" ? name : path.posix.join(base, name)));
  const branch = String(flags.branch ?? "main");

  await Bun.$`git submodule add -b ${branch} ${url} ${packagePath}`;
  const modules = await readGitmodules(gitmodulesPath);
  const added = modules.find((mod) => mod.path === packagePath);
  if (added) {
    added.name = packagePath;
    added.branch = branch;
    await writeGitmodules(gitmodulesPath, modules);
  }
  console.log(`added ${packagePath}`);
}

async function remove(query: string | undefined): Promise<void> {
  if (!query) throw new Error("remove requires a package name or path");
  const item = (await packages()).find((pkg) => pkg.name === query || pkg.path === query || path.basename(pkg.path ?? "") === query);
  if (!item?.path) throw new Error(`package not found: ${query}`);
  await Bun.$`git submodule deinit -f -- ${item.path}`;
  await Bun.$`git rm -f ${item.path}`;
  console.log(`removed ${item.path}`);
}

async function sync(): Promise<void> {
  await Bun.$`git submodule sync --recursive`;
  await Bun.$`git submodule update --init --recursive`;
}

async function stateCommand(action: string | undefined): Promise<void> {
  const state = sharedState(root);
  await ensureSharedState(state);
  if (!action || action === "init") {
    console.log(`initialized ${path.relative(root, state.stateDir)}`);
    return;
  }
  if (action === "env") {
    console.log(await Bun.file(state.envFile).text());
    return;
  }
  throw new Error(`unknown state action: ${action}`);
}

async function install(values: string[]): Promise<void> {
  const [kind, name, source] = values as [InstallKind | undefined, string | undefined, string | undefined];
  if (!kind || !["skill", "plugin", "cli"].includes(kind)) throw new Error("install kind must be skill, plugin, or cli");
  if (!name || !source) throw new Error("install requires a name and source");

  const state = sharedState(root);
  await ensureSharedState(state);
  const targetBase = kind === "skill" ? state.skillsDir : kind === "plugin" ? state.pluginsDir : state.clisDir;
  const target = path.join(targetBase, name);
  if (await exists(target)) throw new Error(`install target already exists: ${target}`);

  if (source.startsWith("http") || source.endsWith(".git")) await Bun.$`git clone ${source} ${target}`;
  else {
    await mkdir(target, { recursive: true });
    await cp(source, target, { recursive: true });
  }

  const installs = await readInstalls(state);
  installs.push({ name, kind, source, path: target, installedAt: new Date().toISOString() });
  await writeInstalls(state, installs);
  console.log(`installed ${kind} ${name}`);
}

async function installs(flags: Record<string, string | boolean>): Promise<void> {
  const state = sharedState(root);
  await ensureSharedState(state);
  const records = await readInstalls(state);
  if (flags.json) console.log(JSON.stringify(records, null, 2));
  else for (const record of records) console.log(`${record.kind.padEnd(8)} ${record.name.padEnd(24)} ${record.path}`);
}

async function credits(flags: Record<string, string | boolean>): Promise<void> {
  const state = sharedState(root);
  await ensureSharedState(state);
  const text = await Bun.file(state.creditsFile).text();
  if (flags.json) console.log(text.trim());
  else console.log(`shared credit store: ${path.relative(root, state.creditsFile)}`);
}

async function doctor(): Promise<void> {
  const state = sharedState(root);
  await ensureSharedState(state);
  const missing: string[] = [];
  for (const item of await packages()) {
    if (!item.path) missing.push(`${item.name}: missing path`);
    else if (!(await exists(path.join(root, item.path)))) missing.push(`${item.name}: missing checkout at ${item.path}`);
  }
  for (const file of [state.envFile, state.creditsFile, state.installsFile]) {
    if (!(await exists(file))) missing.push(`missing shared state file: ${file}`);
  }
  if (missing.length > 0) {
    console.error(missing.join("\n"));
    process.exitCode = 1;
  } else console.log("ok");
}

async function main(): Promise<void> {
  const [command = "help", ...rest] = Bun.argv.slice(2);
  const { values, flags } = parseArgs(rest);
  if (command === "help" || flags.help) return help();
  if (command === "list") return list(flags);
  if (command === "info") return info(values[0], flags);
  if (command === "add") return add(values, flags);
  if (command === "remove") return remove(values[0]);
  if (command === "sync") return sync();
  if (command === "state") return stateCommand(values[0]);
  if (command === "install") return install(values);
  if (command === "installs") return installs(flags);
  if (command === "credits") return credits(flags);
  if (command === "doctor") return doctor();
  throw new Error(`unknown command: ${command}`);
}

main().catch((error) => {
  console.error(`agents: ${error.message}`);
  process.exitCode = 1;
});
