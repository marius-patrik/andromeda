import * as cp from "node:child_process";
import * as path from "node:path";
import type * as vscode from "vscode";

let serverProcess: cp.ChildProcess | undefined;
let serverPort: number | undefined;
let startPromise: Promise<number> | undefined;
let refCount = 0;

export async function acquireServer(context: vscode.ExtensionContext): Promise<number> {
  if (startPromise) {
    const port = await startPromise;
    refCount++;
    return port;
  }

  startPromise = startServerLocked(context);
  try {
    const port = await startPromise;
    refCount++;
    return port;
  } catch (error) {
    startPromise = undefined;
    throw error;
  }
}

export async function releaseServer(): Promise<void> {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0) {
    await stopServer();
  }
}

export function getServerPort(): number | undefined {
  return serverPort;
}

async function startServerLocked(context: vscode.ExtensionContext): Promise<number> {
  if (serverPort && serverProcess) {
    return serverPort;
  }

  const serverPath = path.join(context.extensionPath, "out", "extension", "server.js");
  const webviewRoot = path.join(context.extensionPath, "out", "webview");

  serverProcess = cp.spawn("bun", [serverPath], {
    env: {
      ...process.env,
      VSDAW_WEBVIEW_ROOT: webviewRoot,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  return new Promise((resolve, reject) => {
    const proc = serverProcess;
    if (!proc) {
      reject(new Error("VSDAW audio server process is not available"));
      return;
    }

    const onError = (error: Error) => reject(error);
    proc.on("error", onError);
    proc.on("exit", (code) => {
      if (!serverPort) {
        reject(new Error(`VSDAW audio server exited before announcing port (code ${code})`));
      }
    });

    proc.stderr?.on("data", (data) => {
      console.error("[vsdaw audio server]", data.toString());
    });

    const timeout = setTimeout(() => {
      serverProcess?.kill();
      reject(new Error("VSDAW audio server did not announce port within 10 seconds"));
    }, 10000);

    proc.stdout?.on("data", (data) => {
      const text = data.toString();
      const match = text.match(/PORT:(\d+)/);
      if (match) {
        clearTimeout(timeout);
        serverPort = Number.parseInt(match[1], 10);
        resolve(serverPort);
      }
    });
  });
}

async function stopServer(): Promise<void> {
  startPromise = undefined;
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = undefined;
  }
  serverPort = undefined;
}
