import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as vscode from "vscode";
import { createEmptyProject, writeBundle } from "../shared/bundle.js";
import { MessageType, type ProjectLoadPayload } from "../shared/protocol.js";
import { acquireServer, releaseServer } from "./audioServer.js";
import { createEngineWebview } from "./engineWebview.js";
import type { MessageRouter } from "./messageRouter.js";
import type { MessageEnvelope, ProjectSession } from "./types.js";

export interface ProjectManagerOptions {
  context: vscode.ExtensionContext;
  outputChannel: vscode.OutputChannel;
  router: MessageRouter;
}

export class ProjectManager {
  private sessions = new Map<string, ProjectSession>();
  private uriToProjectId = new Map<string, string>();
  private activeProjectId: string | undefined;
  private serverOrigin: string | undefined;

  constructor(private options: ProjectManagerOptions) {}

  get context(): vscode.ExtensionContext {
    return this.options.context;
  }

  get router(): MessageRouter {
    return this.options.router;
  }

  get outputChannel(): vscode.OutputChannel {
    return this.options.outputChannel;
  }

  getServerOrigin(): string | undefined {
    return this.serverOrigin;
  }

  getActiveProjectId(): string | undefined {
    return this.activeProjectId;
  }

  setActiveProjectId(projectId: string | undefined): void {
    this.activeProjectId = projectId;
  }

  getSession(projectId: string): ProjectSession | undefined {
    return this.sessions.get(projectId);
  }

  getSessionByUri(uri: vscode.Uri): ProjectSession | undefined {
    const projectId = this.uriToProjectId.get(uri.toString());
    return projectId ? this.sessions.get(projectId) : undefined;
  }

  async initialize(): Promise<void> {
    await this.offerRecovery();
  }

  async newProject(): Promise<void> {
    const uri = await createNewProjectUri(this.context);
    if (!uri) return;

    await writeEmptyProject(uri);
    await openProjectFile(uri);
  }

  async openProject(): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
      canSelectFiles: true,
      canSelectFolders: false,
      canSelectMany: false,
      filters: { "VSDAW Project": ["vsdaw"] },
      openLabel: "Open Project",
    });
    if (!uris || uris.length === 0) return;
    await openProjectFile(uris[0]);
  }

  async ensureProjectForDocument(
    uri: vscode.Uri,
    timelinePanel: vscode.WebviewPanel,
  ): Promise<ProjectSession> {
    const existing = this.getSessionByUri(uri);
    if (existing) {
      existing.views.set("vsdaw.editor", timelinePanel);
      this.router.registerView(existing.projectId, timelinePanel);
      this.activeProjectId = existing.projectId;
      return existing;
    }

    return this.createSession(uri, timelinePanel);
  }

  private async createSession(
    uri: vscode.Uri,
    timelinePanel: vscode.WebviewPanel,
  ): Promise<ProjectSession> {
    const port = await acquireServer(this.context);
    this.serverOrigin = `http://127.0.0.1:${port}`;

    const projectId = crypto.randomUUID();
    const isUntitled = uri.scheme !== "file";

    const session: ProjectSession = {
      projectId,
      uri,
      enginePanel: createEngineWebview(this.context, port, projectId, this.router),
      engineReady: false,
      pendingEngineMessages: [],
      views: new Map(),
      isDirty: false,
      isUntitled,
    };

    session.views.set("vsdaw.editor", timelinePanel);
    this.router.registerView(projectId, timelinePanel);

    this.sessions.set(projectId, session);
    this.uriToProjectId.set(uri.toString(), projectId);
    this.activeProjectId = projectId;

    if (uri.scheme === "file") {
      try {
        await this.loadProjectIntoSession(session);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[project] failed to load ${uri.fsPath}: ${message}`);
        vscode.window.showWarningMessage(`VSDAW could not load existing project data: ${message}`);
      }
    }

    timelinePanel.onDidDispose(() => {
      this.closeProject(projectId).catch(() => {
        // ignore
      });
    });

    return session;
  }

  async closeProject(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) return;

    this.clearAutoSave(session);
    this.router.unregisterEngine(projectId);

    try {
      session.enginePanel.dispose();
    } catch {
      // ignore
    }

    for (const [, panel] of session.views) {
      try {
        panel.dispose();
      } catch {
        // ignore
      }
    }

    this.sessions.delete(projectId);
    this.uriToProjectId.delete(session.uri.toString());
    if (this.activeProjectId === projectId) {
      this.activeProjectId = undefined;
    }

    if (this.sessions.size === 0) {
      await releaseServer();
      this.serverOrigin = undefined;
    }
  }

  async closeAll(): Promise<void> {
    const ids = Array.from(this.sessions.keys());
    await Promise.all(ids.map((id) => this.closeProject(id)));
  }

  async saveProject(projectId: string): Promise<void> {
    const session = this.sessions.get(projectId);
    if (!session) {
      throw new Error(`No session for project ${projectId}`);
    }
    await this.saveSession(session);
  }

  async saveProjectByUri(uri: vscode.Uri): Promise<void> {
    const session = this.getSessionByUri(uri);
    if (!session) {
      throw new Error(`No project session for ${uri.toString()}`);
    }
    await this.saveSession(session);
  }

  private async saveSession(session: ProjectSession): Promise<void> {
    let targetUri = session.uri;
    if (session.isUntitled) {
      const picked = await vscode.window.showSaveDialog({
        defaultUri: targetUri,
        filters: { "VSDAW Project": ["vsdaw"] },
        saveLabel: "Save Project",
      });
      if (!picked) return;
      targetUri = picked;
      session.isUntitled = false;
      this.uriToProjectId.delete(session.uri.toString());
      session.uri = targetUri;
      this.uriToProjectId.set(targetUri.toString(), session.projectId);
    }

    const response = await this.router.requestEngine(
      session.projectId,
      MessageType.ProjectSave,
      { format: "arraybuffer" },
      { responseType: `${MessageType.ProjectSave}.ack`, timeoutMs: 30000 },
    );
    const bytes = response.payload as Uint8Array | ArrayBuffer | undefined;
    if (!bytes) {
      throw new Error("Engine returned empty project data");
    }

    const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
    await this.writeProjectBytes(targetUri, data);
    session.isDirty = false;
    this.updateSaveIndicator(session);
  }

  markDirty(projectId: string): void {
    const session = this.sessions.get(projectId);
    if (!session) return;
    session.isDirty = true;
    this.updateSaveIndicator(session);
    this.scheduleAutoSave(session);
  }

  onEngineReady(projectId: string, payload: unknown): void {
    const session = this.sessions.get(projectId);
    if (!session) return;
    session.engineReady = true;
    this.outputChannel.appendLine(
      `[project] engine ready for ${projectId}: ${JSON.stringify(payload)}`,
    );

    for (const queued of session.pendingEngineMessages) {
      this.router.routeToEngine(projectId, queued);
    }
    session.pendingEngineMessages = [];
  }

  onEngineError(projectId: string, payload: unknown): void {
    this.outputChannel.appendLine(
      `[project] engine error for ${projectId}: ${JSON.stringify(payload)}`,
    );
    vscode.window.showErrorMessage(`VSDAW engine error: ${JSON.stringify(payload)}`);
  }

  onViewMessage(projectId: string, _message: MessageEnvelope): void {
    this.markDirty(projectId);
  }

  private scheduleAutoSave(session: ProjectSession): void {
    this.clearAutoSaveTimer(session);
    const config = vscode.workspace.getConfiguration("vsdaw");
    if (!config.get<boolean>("autoSave", true)) return;

    const delay = config.get<number>("autoSaveDelay", 500);
    session.autoSaveTimer = setTimeout(() => {
      this.saveProject(session.projectId).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[autosave] failed: ${message}`);
      });
    }, delay);

    this.scheduleBackup(session);
  }

  private scheduleBackup(session: ProjectSession): void {
    if (session.backupTimer) return;
    session.backupTimer = setInterval(() => {
      this.writeRecoveryBackup(session).catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        this.outputChannel.appendLine(`[backup] failed: ${message}`);
      });
    }, 60000);
  }

  private clearAutoSave(session: ProjectSession): void {
    this.clearAutoSaveTimer(session);
    if (session.backupTimer) {
      clearInterval(session.backupTimer);
      session.backupTimer = undefined;
    }
  }

  private clearAutoSaveTimer(session: ProjectSession): void {
    if (session.autoSaveTimer) {
      clearTimeout(session.autoSaveTimer);
      session.autoSaveTimer = undefined;
    }
  }

  private async writeProjectBytes(uri: vscode.Uri, data: Uint8Array): Promise<void> {
    if (uri.scheme === "file") {
      const tempPath = `${uri.fsPath}.tmp-${Date.now()}`;
      const tempUri = vscode.Uri.file(tempPath);
      await vscode.workspace.fs.writeFile(tempUri, data);
      await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
    } else {
      await vscode.workspace.fs.writeFile(uri, data);
    }
  }

  private async loadProjectIntoSession(session: ProjectSession): Promise<void> {
    const data = await vscode.workspace.fs.readFile(session.uri);
    const payload: ProjectLoadPayload = {
      data: Buffer.from(data).toString("base64"),
    };

    const loadMessage: MessageEnvelope = {
      projectId: session.projectId,
      direction: "host-to-engine",
      type: MessageType.ProjectLoad,
      payload,
    };

    if (session.engineReady) {
      this.router.routeToEngine(session.projectId, loadMessage);
    } else {
      session.pendingEngineMessages.push(loadMessage);
    }
  }

  private async writeRecoveryBackup(session: ProjectSession): Promise<void> {
    const recoveryDir = this.getRecoveryDir();
    await fs.mkdir(recoveryDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const recoveryPath = path.join(recoveryDir, `${session.projectId}-${timestamp}.vsdaw`);

    try {
      const response = await this.router.requestEngine(
        session.projectId,
        MessageType.ProjectSave,
        { format: "arraybuffer" },
        { responseType: `${MessageType.ProjectSave}.ack`, timeoutMs: 30000 },
      );
      const bytes = response.payload as Uint8Array | ArrayBuffer | undefined;
      if (!bytes) return;
      const data = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
      await fs.writeFile(recoveryPath, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.outputChannel.appendLine(`[recovery] backup skipped: ${message}`);
    }
  }

  private async offerRecovery(): Promise<void> {
    const recoveryDir = this.getRecoveryDir();
    let files: string[] = [];
    try {
      files = (await fs.readdir(recoveryDir)).filter((f) => f.endsWith(".vsdaw"));
    } catch {
      return;
    }
    if (files.length === 0) return;

    const selected = await vscode.window.showWarningMessage(
      `VSDAW found ${files.length} recovery file(s). Restore a recovered project?`,
      "Open recovery folder",
      "Dismiss",
    );
    if (selected === "Open recovery folder") {
      const uri = vscode.Uri.file(recoveryDir);
      await vscode.commands.executeCommand("revealFileInOS", uri);
    }
  }

  private getRecoveryDir(): string {
    const base =
      this.context.storageUri?.fsPath ??
      path.join(this.context.globalStorageUri.fsPath, "workspace");
    return path.join(base, ".vsdaw", ".recovery");
  }

  private updateSaveIndicator(session: ProjectSession): void {
    const timeline = session.views.get("vsdaw.editor");
    if (timeline) {
      timeline.title = session.isDirty
        ? `Timeline (${session.projectId.slice(0, 8)}) •`
        : `Timeline (${session.projectId.slice(0, 8)})`;
    }
  }
}

export async function createNewProjectUri(
  context: vscode.ExtensionContext,
): Promise<vscode.Uri | undefined> {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    const result = await vscode.window.showSaveDialog({
      title: "Create VSDAW Project",
      defaultUri: vscode.Uri.file(path.join(vscode.env.appRoot, "Untitled.vsdaw")),
      filters: { "VSDAW Project": ["vsdaw"] },
    });
    return result;
  }

  let index = 1;
  let candidate = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, "Untitled.vsdaw"));
  while (await fileExists(candidate)) {
    candidate = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, `Untitled-${index}.vsdaw`));
    index++;
  }
  return candidate;
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export async function writeEmptyProject(uri: vscode.Uri): Promise<void> {
  const config = vscode.workspace.getConfiguration("vsdaw");
  const sampleRate = config.get<number>("audio.defaultSampleRate", 48000);
  const project = createEmptyProject(path.basename(uri.fsPath, ".vsdaw"), sampleRate);
  const bytes = await writeBundle(project);
  await vscode.workspace.fs.writeFile(uri, bytes);
}

export async function openProjectFile(uri: vscode.Uri): Promise<void> {
  await vscode.commands.executeCommand("vscode.openWith", uri, "vsdaw.editor");
}
