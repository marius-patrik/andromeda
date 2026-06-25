import * as vscode from "vscode";
import type { ProjectManager } from "../projectManager.js";
import { setViewHtml } from "../views/base.js";

export class VsdawDocument implements vscode.CustomDocument {
  constructor(public readonly uri: vscode.Uri) {}

  dispose(): void {
    // No additional cleanup required; the project manager owns the session.
  }
}

export class VsdawEditorProvider implements vscode.CustomEditorProvider<VsdawDocument> {
  public static readonly viewType = "vsdaw.editor";

  private _onDidChangeCustomDocument = new vscode.EventEmitter<
    vscode.CustomDocumentContentChangeEvent<VsdawDocument>
  >();
  public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

  constructor(
    private context: vscode.ExtensionContext,
    private projectManager: ProjectManager,
    private getServerOrigin: () => string | undefined,
  ) {}

  openCustomDocument(
    uri: vscode.Uri,
    _openContext: vscode.CustomDocumentOpenContext,
    _token: vscode.CancellationToken,
  ): VsdawDocument | Thenable<VsdawDocument> {
    return new VsdawDocument(uri);
  }

  async resolveCustomEditor(
    document: VsdawDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken,
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, "out", "webview")],
    };

    const session = await this.projectManager.ensureProjectForDocument(document.uri, webviewPanel);

    setViewHtml({
      webview: webviewPanel.webview,
      extensionUri: this.context.extensionUri,
      projectId: session.projectId,
      viewType: VsdawEditorProvider.viewType,
      serverOrigin: this.getServerOrigin() ?? "",
    });

    webviewPanel.onDidChangeViewState((e) => {
      if (e.webviewPanel.active) {
        this.projectManager.setActiveProjectId(session.projectId);
      }
    });

    webviewPanel.onDidDispose(() => {
      if (this.projectManager.getActiveProjectId() === session.projectId) {
        this.projectManager.setActiveProjectId(undefined);
      }
    });
  }

  async saveCustomDocument(
    document: VsdawDocument,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    if (cancellation.isCancellationRequested) return;
    await this.projectManager.saveProjectByUri(document.uri);
  }

  async saveCustomDocumentAs(
    document: VsdawDocument,
    destination: vscode.Uri,
    cancellation: vscode.CancellationToken,
  ): Promise<void> {
    if (cancellation.isCancellationRequested) return;
    const session = this.projectManager.getSessionByUri(document.uri);
    if (!session) {
      throw new Error("No project session for document");
    }
    session.uri = destination;
    session.isUntitled = false;
    await this.projectManager.saveProject(session.projectId);
  }

  async revertCustomDocument(
    _document: VsdawDocument,
    _cancellation: vscode.CancellationToken,
  ): Promise<void> {
    // Revert is not supported in Phase 2; the engine owns runtime state.
  }

  async backupCustomDocument(
    document: VsdawDocument,
    context: vscode.CustomDocumentBackupContext,
    _cancellation: vscode.CancellationToken,
  ): Promise<vscode.CustomDocumentBackup> {
    return {
      id: context.destination.toString(),
      delete: async () => {
        try {
          await vscode.workspace.fs.delete(context.destination);
        } catch {
          // ignore
        }
      },
    };
  }
}
