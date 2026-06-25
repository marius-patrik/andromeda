import * as vscode from "vscode";
import { releaseServer } from "./audioServer.js";
import { registerCommands } from "./commands.js";
import { VsdawEditorProvider } from "./editor/vsdawEditor.js";
import { MessageRouter } from "./messageRouter.js";
import { ProjectManager } from "./projectManager.js";
import {
  BrowserWebviewProvider,
  GraphWebviewProvider,
  MixerWebviewProvider,
  PianoRollWebviewProvider,
} from "./views/index.js";

let projectManager: ProjectManager | undefined;

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("VSDAW");
  context.subscriptions.push(outputChannel);

  const router = new MessageRouter(outputChannel, {
    onEngineReady: (projectId, payload) => {
      outputChannel.appendLine(`[engine] ready for ${projectId}: ${JSON.stringify(payload)}`);
      const session = projectManager?.getSession(projectId);
      if (session) {
        session.engineReady = true;
      }
    },
    onEngineError: (projectId, payload) => {
      outputChannel.appendLine(`[engine] error for ${projectId}: ${JSON.stringify(payload)}`);
      vscode.window.showErrorMessage(`Engine error in ${projectId}`);
    },
    onViewMessage: (projectId, message) => {
      outputChannel.appendLine(`[view] ${projectId}: ${message.type}`);
    },
  });

  projectManager = new ProjectManager({
    context,
    outputChannel,
    router,
  });

  const getServerOrigin = () => projectManager?.getServerOrigin();

  const mixerProvider = new MixerWebviewProvider(context, router, getServerOrigin);
  const pianoRollProvider = new PianoRollWebviewProvider(context, router, getServerOrigin);
  const browserProvider = new BrowserWebviewProvider(context, router, getServerOrigin);
  const graphProvider = new GraphWebviewProvider(context, router, getServerOrigin);

  const editorProvider = new VsdawEditorProvider(context, projectManager, getServerOrigin);
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(VsdawEditorProvider.viewType, editorProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  context.subscriptions.push(
    ...registerCommands({
      context,
      projectManager,
      mixerProvider,
      pianoRollProvider,
      browserProvider,
      graphProvider,
    }),
  );

  await projectManager.initialize();
}

export function deactivate() {
  void projectManager?.closeAll();
  void releaseServer();
}
