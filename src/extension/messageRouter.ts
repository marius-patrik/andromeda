import type * as vscode from "vscode";
import { MessageSchema, MessageType } from "../shared/protocol.js";
import type { MessageEnvelope, PendingRequest } from "./types.js";

export interface MessageRouterCallbacks {
  onEngineReady: (projectId: string, payload: unknown) => void;
  onEngineError: (projectId: string, payload: unknown) => void;
  onViewMessage: (projectId: string, message: MessageEnvelope) => void;
}

export class MessageRouter {
  private engines = new Map<string, vscode.WebviewPanel>();
  private views = new Map<string, Set<vscode.WebviewPanel>>();
  private pending = new Map<string, Map<string, PendingRequest>>();

  constructor(
    private outputChannel: vscode.OutputChannel,
    private callbacks: MessageRouterCallbacks,
  ) {}

  registerEngine(projectId: string, panel: vscode.WebviewPanel): void {
    this.engines.set(projectId, panel);
    const disposables: vscode.Disposable[] = [];

    disposables.push(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        this.handleEngineMessage(projectId, raw);
      }),
    );

    disposables.push(
      panel.onDidDispose(() => {
        this.unregisterEngine(projectId);
        for (const d of disposables) {
          d.dispose();
        }
      }),
    );
  }

  unregisterEngine(projectId: string): void {
    this.engines.delete(projectId);
    const pending = this.pending.get(projectId);
    if (pending) {
      for (const [, req] of pending) {
        clearTimeout(req.timeout);
        req.reject(new Error("Engine webview disposed"));
      }
      this.pending.delete(projectId);
    }
    this.views.delete(projectId);
  }

  registerView(projectId: string, panel: vscode.WebviewPanel): void {
    let set = this.views.get(projectId);
    if (!set) {
      set = new Set();
      this.views.set(projectId, set);
    }
    set.add(panel);

    const disposables: vscode.Disposable[] = [];
    disposables.push(
      panel.webview.onDidReceiveMessage((raw: unknown) => {
        this.handleViewMessage(projectId, raw);
      }),
    );
    disposables.push(
      panel.onDidDispose(() => {
        this.unregisterView(projectId, panel);
        for (const d of disposables) {
          d.dispose();
        }
      }),
    );
  }

  unregisterView(projectId: string, panel: vscode.WebviewPanel): void {
    const set = this.views.get(projectId);
    if (set) {
      set.delete(panel);
      if (set.size === 0) {
        this.views.delete(projectId);
      }
    }
  }

  getViews(projectId: string): vscode.WebviewPanel[] {
    const set = this.views.get(projectId);
    return set ? Array.from(set) : [];
  }

  findView(projectId: string, viewType: string): vscode.WebviewPanel | undefined {
    const set = this.views.get(projectId);
    if (!set) return undefined;
    for (const panel of set) {
      if (panel.viewType === viewType) {
        return panel;
      }
    }
    return undefined;
  }

  routeToEngine(projectId: string, message: Omit<MessageEnvelope, "direction">): void {
    const panel = this.engines.get(projectId);
    if (!panel) {
      this.outputChannel.appendLine(
        `[router] no engine for project ${projectId} (dropping ${message.type})`,
      );
      return;
    }
    const envelope: MessageEnvelope = { ...message, direction: "host-to-engine" };
    panel.webview.postMessage(envelope);
  }

  routeToViews(projectId: string, message: Omit<MessageEnvelope, "direction">): void {
    const envelope: MessageEnvelope = { ...message, direction: "host-to-view" };
    const set = this.views.get(projectId);
    if (!set) return;
    for (const panel of set) {
      panel.webview.postMessage(envelope);
    }
  }

  async requestEngine(
    projectId: string,
    type: string,
    payload: unknown,
    options: { responseType?: string; timeoutMs?: number } = {},
  ): Promise<MessageEnvelope> {
    const panel = this.engines.get(projectId);
    if (!panel) {
      throw new Error(`No engine webview for project ${projectId}`);
    }

    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeoutMs = options.timeoutMs ?? 10000;

    return new Promise<MessageEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.clearPending(projectId, requestId);
        reject(new Error(`Engine request ${type} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const pending: PendingRequest = {
        resolve,
        reject,
        timeout,
        responseType: options.responseType,
      };

      let map = this.pending.get(projectId);
      if (!map) {
        map = new Map();
        this.pending.set(projectId, map);
      }
      map.set(requestId, pending);

      const envelope: MessageEnvelope = {
        projectId,
        direction: "host-to-engine",
        type,
        payload,
        requestId,
      };
      panel.webview.postMessage(envelope);
    });
  }

  private clearPending(projectId: string, requestId: string): void {
    const map = this.pending.get(projectId);
    if (!map) return;
    const req = map.get(requestId);
    if (req) {
      clearTimeout(req.timeout);
      map.delete(requestId);
    }
    if (map.size === 0) {
      this.pending.delete(projectId);
    }
  }

  private handleEngineMessage(projectId: string, raw: unknown): void {
    const parse = MessageSchema.safeParse(raw);
    if (!parse.success) {
      this.outputChannel.appendLine(`[router] invalid engine message: ${JSON.stringify(raw)}`);
      return;
    }
    const message = parse.data as MessageEnvelope;
    if (message.projectId !== projectId) {
      this.outputChannel.appendLine(
        `[router] engine message projectId mismatch: ${message.projectId} vs ${projectId}`,
      );
      return;
    }

    // Resolve pending requests first.
    if (message.requestId) {
      const map = this.pending.get(projectId);
      const req = map?.get(message.requestId);
      if (req) {
        if (!req.responseType || req.responseType === message.type) {
          clearTimeout(req.timeout);
          map!.delete(message.requestId);
          if (map!.size === 0) {
            this.pending.delete(projectId);
          }
          req.resolve(message);
          return;
        }
      }
    }

    if (message.type === MessageType.EngineReady) {
      this.callbacks.onEngineReady(projectId, message.payload);
      return;
    }
    if (message.type === MessageType.EngineError) {
      this.callbacks.onEngineError(projectId, message.payload);
      return;
    }

    // Broadcast engine state to all views for this project.
    this.routeToViews(projectId, {
      projectId,
      type: message.type,
      payload: message.payload,
      requestId: message.requestId,
    });
  }

  private handleViewMessage(projectId: string, raw: unknown): void {
    const parse = MessageSchema.safeParse(raw);
    if (!parse.success) {
      this.outputChannel.appendLine(`[router] invalid view message: ${JSON.stringify(raw)}`);
      return;
    }
    const message = parse.data as MessageEnvelope;
    if (message.projectId !== projectId) {
      this.outputChannel.appendLine(
        `[router] view message projectId mismatch: ${message.projectId} vs ${projectId}`,
      );
      return;
    }

    this.callbacks.onViewMessage(projectId, message);

    this.routeToEngine(projectId, {
      projectId,
      type: message.type,
      payload: message.payload,
      requestId: message.requestId,
    });
  }
}
