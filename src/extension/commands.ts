import * as vscode from "vscode";
import { MessageType } from "../shared/protocol.js";
import type { ProjectManager } from "./projectManager.js";
import type {
  BrowserWebviewProvider,
  GraphWebviewProvider,
  MixerWebviewProvider,
  PianoRollWebviewProvider,
} from "./views/index.js";

export interface CommandDependencies {
  context: vscode.ExtensionContext;
  projectManager: ProjectManager;
  mixerProvider: MixerWebviewProvider;
  pianoRollProvider: PianoRollWebviewProvider;
  browserProvider: BrowserWebviewProvider;
  graphProvider: GraphWebviewProvider;
}

export function registerCommands(deps: CommandDependencies): vscode.Disposable[] {
  const { context, projectManager } = deps;
  const disposables: vscode.Disposable[] = [];

  const register = (command: string, handler: () => Promise<void> | void) => {
    disposables.push(
      vscode.commands.registerCommand(command, async () => {
        try {
          await handler();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`VSDAW: ${message}`);
        }
      }),
    );
  };

  register("vsdaw.newProject", () => projectManager.newProject());
  register("vsdaw.openProject", () => projectManager.openProject());

  register("vsdaw.showTimeline", () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;
    const session = projectManager.getSession(projectId);
    if (!session) return;
    const timeline = session.views.get("vsdaw.editor");
    if (timeline) {
      timeline.reveal(vscode.ViewColumn.One);
    } else {
      vscode.commands.executeCommand("vscode.openWith", session.uri, "vsdaw.editor", {
        preview: false,
      });
    }
  });

  register("vsdaw.showMixer", () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;
    deps.mixerProvider.show(projectId);
  });

  register("vsdaw.showPianoRoll", () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;
    deps.pianoRollProvider.show(projectId);
  });

  register("vsdaw.showBrowser", () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;
    deps.browserProvider.show(projectId);
  });

  register("vsdaw.showGraph", () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;
    deps.graphProvider.show(projectId);
  });

  register("vsdaw.export", async () => {
    const projectId = getActiveProjectId(projectManager);
    if (!projectId) return;

    const format = await vscode.window.showQuickPick(["wav", "flac", "ogg"], {
      placeHolder: "Select export format",
    });
    if (!format) return;

    const config = vscode.workspace.getConfiguration("vsdaw");
    const defaultDir = config.get<string>("export.defaultDirectory", "${workspaceFolder}/exports");
    const dir = defaultDir.replace(
      "${workspaceFolder}",
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? "",
    );
    const destination = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(`${dir}/export.${format}`),
      filters: { [format.toUpperCase()]: [format] },
      saveLabel: "Export",
    });
    if (!destination) return;

    await projectManager.router.requestEngine(
      projectId,
      MessageType.ExportRender,
      {
        format: format as "wav" | "flac" | "ogg",
        fileName: destination.fsPath,
        start: 0,
        end: 0,
        stems: false,
      },
      { responseType: `${MessageType.ExportRender}.ack`, timeoutMs: 120000 },
    );

    vscode.window.showInformationMessage(`VSDAW export to ${destination.fsPath} complete`);
  });

  register("vsdaw.settings", () => {
    vscode.commands.executeCommand("workbench.action.openSettings", "vsdaw");
  });

  context.subscriptions.push(...disposables);
  return disposables;
}

function getActiveProjectId(projectManager: ProjectManager): string | undefined {
  const projectId = projectManager.getActiveProjectId();
  if (projectId) return projectId;

  vscode.window
    .showInformationMessage("No active VSDAW project. Open or create a project first.")
    .then(() => undefined);
  return undefined;
}
