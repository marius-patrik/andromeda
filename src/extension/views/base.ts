import * as crypto from "node:crypto";
import * as vscode from "vscode";
import type { MessageRouter } from "../messageRouter.js";

export interface ViewHtmlOptions {
  webview: vscode.Webview;
  extensionUri: vscode.Uri;
  projectId: string;
  viewType: string;
  bundleName?: string;
  serverOrigin: string;
}

export function setViewHtml(options: ViewHtmlOptions): void {
  const { webview, extensionUri, projectId, viewType, bundleName, serverOrigin } = options;
  const nonce = crypto.randomUUID();
  const cspSource = webview.cspSource;
  const resolvedBundleName = bundleName ?? viewType;
  const bundleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, "out", "webview", "views", `${resolvedBundleName}.js`),
  );

  webview.html = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src ${serverOrigin}; script-src 'nonce-${nonce}' ${cspSource}; style-src 'unsafe-inline' ${cspSource}; connect-src ${serverOrigin} ${cspSource}; img-src data: blob: ${cspSource}; font-src ${cspSource};">
      <style>
        html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; background: var(--vscode-editor-background); color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
        #root { width: 100%; height: 100%; display: flex; flex-direction: column; }
        #placeholder { margin: auto; text-align: center; opacity: 0.7; }
      </style>
    </head>
    <body>
      <div id="root">
        <div id="placeholder">
          <h2>${viewType}</h2>
          <p>Project: ${projectId}</p>
        </div>
      </div>
      <script nonce="${nonce}">
        (function () {
          const vscode = acquireVsCodeApi();
          const projectId = ${JSON.stringify(projectId)};
          const viewType = ${JSON.stringify(viewType)};

          window.vsdaw = {
            projectId,
            viewType,
            postMessage(type, payload) {
              vscode.postMessage({ projectId, direction: 'view-to-host', type, payload });
            }
          };

          window.addEventListener('message', function (event) {
            if (event.source !== window) return;
            const msg = event.data;
            if (msg && msg.projectId === projectId) {
              if (window.onVsdawMessage) {
                window.onVsdawMessage(msg);
              }
            }
          });

          window.vsdaw.postMessage('view.ready', { viewType });

          const script = document.createElement('script');
          script.src = ${JSON.stringify(bundleUri.toString())};
          script.nonce = ${JSON.stringify(nonce)};
          script.onerror = function () {
            console.warn('[vsdaw] view bundle not found for ' + viewType);
          };
          document.head.appendChild(script);
        })();
      </script>
    </body>
    </html>
  `;
}

export interface ViewPanelOptions {
  context: vscode.ExtensionContext;
  router: MessageRouter;
  projectId: string;
  viewType: string;
  title: string;
  column: vscode.ViewColumn;
  serverOrigin: string;
}

export function createViewPanel(options: ViewPanelOptions): vscode.WebviewPanel {
  const { context, router, projectId, viewType, title, column, serverOrigin } = options;

  const existing = router.findView(projectId, viewType);
  if (existing) {
    existing.reveal(column);
    return existing;
  }

  const panel = vscode.window.createWebviewPanel(viewType, title, column, {
    enableScripts: true,
    retainContextWhenHidden: true,
    localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "out", "webview")],
  });

  setViewHtml({
    webview: panel.webview,
    extensionUri: context.extensionUri,
    projectId,
    viewType,
    serverOrigin,
  });

  router.registerView(projectId, panel);
  return panel;
}
