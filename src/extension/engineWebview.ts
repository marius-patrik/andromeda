import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { MessageRouter } from "./messageRouter.js";

export interface EngineWebviewOptions {
  context: vscode.ExtensionContext;
  port: number;
  projectId: string;
  router: MessageRouter;
}

export function setEngineWebviewHtml(
  panel: vscode.WebviewPanel,
  origin: string,
  projectId: string,
): void {
  const iframeSrc = `${origin}/engine?projectId=${encodeURIComponent(projectId)}`;
  const nonce = crypto.randomUUID();

  panel.webview.options = { enableScripts: true };
  panel.webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${origin}; script-src 'nonce-${nonce}';">
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); }
        iframe { width: 100%; height: 100%; border: none; }
      </style>
    </head>
    <body>
      <iframe id="engine" src="${iframeSrc}" sandbox="allow-scripts allow-same-origin"></iframe>
      <script nonce="${nonce}">
        (function () {
          const vscode = acquireVsCodeApi();
          const origin = '${origin}';
          window.addEventListener('message', function (event) {
            if (event.origin !== origin) return;
            vscode.postMessage(event.data);
          });
        })();
      </script>
    </body>
    </html>
  `;
}

export function createEngineWebview(
  context: vscode.ExtensionContext,
  port: number,
  projectId: string,
  router: MessageRouter,
): vscode.WebviewPanel {
  const origin = `http://127.0.0.1:${port}`;

  // VS Code has no "hidden" webview panel API. We create the engine webview in
  // a secondary group and preserve focus on the previous editor. It remains
  // alive via retainContextWhenHidden once the user switches away.
  const panel = vscode.window.createWebviewPanel(
    "vsdawEngine",
    `VSDAW Engine (${projectId.slice(0, 8)})`,
    vscode.ViewColumn.Beside,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
    },
  );

  setEngineWebviewHtml(panel, origin, projectId);
  router.registerEngine(projectId, panel);

  // Best-effort attempt to keep the engine panel out of the user's way.
  void Promise.resolve(vscode.commands.executeCommand("workbench.action.focusPreviousGroup")).catch(
    () => {
      // Ignore focus management errors.
    },
  );

  return panel;
}
