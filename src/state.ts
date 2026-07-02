import path from "node:path";
import { mkdir } from "node:fs/promises";

export type InstallKind = "agent" | "cli" | "skill" | "plugin";

export interface InstallRecord {
  name: string;
  kind: InstallKind;
  source: string;
  path: string;
  installedAt: string;
}

export interface CreditStore {
  schemaVersion: 1;
  balances: Record<string, number>;
  updatedAt: string;
}

export interface SharedState {
  root: string;
  stateDir: string;
  clisDir: string;
  skillsDir: string;
  pluginsDir: string;
  creditsFile: string;
  installsFile: string;
  envFile: string;
}

export function sharedState(root: string): SharedState {
  const stateDir = path.join(root, ".agents");
  return {
    root,
    stateDir,
    clisDir: path.join(stateDir, "clis"),
    skillsDir: path.join(stateDir, "skills"),
    pluginsDir: path.join(stateDir, "plugins"),
    creditsFile: path.join(stateDir, "credits.json"),
    installsFile: path.join(stateDir, "installs.json"),
    envFile: path.join(stateDir, "env"),
  };
}

export async function ensureSharedState(state: SharedState): Promise<void> {
  await Promise.all([
    mkdir(state.clisDir, { recursive: true }),
    mkdir(state.skillsDir, { recursive: true }),
    mkdir(state.pluginsDir, { recursive: true }),
  ]);

  if (!(await Bun.file(state.installsFile).exists())) {
    await Bun.write(state.installsFile, "[]\n");
  }

  if (!(await Bun.file(state.creditsFile).exists())) {
    const credits: CreditStore = {
      schemaVersion: 1,
      balances: {},
      updatedAt: new Date().toISOString(),
    };
    await Bun.write(state.creditsFile, `${JSON.stringify(credits, null, 2)}\n`);
  }

  await Bun.write(
    state.envFile,
    [
      `AGENTS_HOME=${state.stateDir}`,
      `AGENTS_CLIS=${state.clisDir}`,
      `AGENTS_SKILLS=${state.skillsDir}`,
      `AGENTS_PLUGINS=${state.pluginsDir}`,
      `AGENTS_CREDITS=${state.creditsFile}`,
      "",
    ].join("\n"),
  );
}

export async function readInstalls(state: SharedState): Promise<InstallRecord[]> {
  if (!(await Bun.file(state.installsFile).exists())) return [];
  return JSON.parse(await Bun.file(state.installsFile).text()) as InstallRecord[];
}

export async function writeInstalls(state: SharedState, installs: InstallRecord[]): Promise<void> {
  await Bun.write(state.installsFile, `${JSON.stringify(installs, null, 2)}\n`);
}
