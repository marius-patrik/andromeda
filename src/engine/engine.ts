import {
  AudioWorklets,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  OfflineEngineRenderer,
  SampleService,
  SampleStorage,
  SoundfontService,
  SoundfontStorage,
  Workers,
} from "@opendaw/studio-core";
import {
  type EngineErrorPayload,
  type EngineReadyPayload,
  type Message,
  MessageType,
  type ProjectState,
  isEngineMessage,
} from "../shared/protocol.js";
import { handleMessage } from "./messageHandlers.js";
import { ProjectController, createBootEnv } from "./projectAdapter.js";

const projectId = new URLSearchParams(window.location.search).get("projectId") ?? "default";

function setStatus(text: string) {
  const el = document.getElementById("status");
  if (el) el.textContent = text;
}

function post<T>(type: string, payload: T) {
  const message: Message<T> = {
    direction: "engine-to-host",
    projectId,
    type,
    payload,
  };
  window.parent.postMessage(message, "*");
}

function broadcast<T>(type: string, payload: T) {
  const message: Message<T> = {
    direction: "host-to-view",
    projectId,
    type,
    payload,
  };
  window.parent.postMessage(message, "*");
}

let controller: ProjectController | null = null;

async function boot() {
  try {
    if (!window.crossOriginIsolated) {
      throw new Error(`crossOriginIsolated is false (${window.crossOriginIsolated})`);
    }

    const origin = window.location.origin;
    const workersUrl = new URL("/workers-main.js", origin).href;
    const processorsUrl = new URL("/processors.js", origin).href;
    const offlineEngineUrl = new URL("/offline-engine.js", origin).href;

    setStatus("Installing workers...");
    await Workers.install(workersUrl);

    setStatus("Installing audio worklets...");
    AudioWorklets.install(processorsUrl);
    OfflineEngineRenderer.install(offlineEngineUrl);

    setStatus("Creating AudioContext...");
    const audioContext = new AudioContext({ latencyHint: 0 });

    setStatus("Creating AudioWorklets...");
    const audioWorklets = await AudioWorklets.createFor(audioContext);

    setStatus("Creating project environment...");
    const bootEnv = createBootEnv(audioContext, audioWorklets);

    setStatus("Creating controller...");
    controller = new ProjectController({
      bootEnv,
      projectId,
      onStateChange: (state: ProjectState) => {
        broadcast(MessageType.StateUpdate, state);
      },
      onTransportPosition: (position: number) => {
        broadcast(MessageType.TransportPositionChanged, { position });
      },
    });

    // Create a default empty project so the engine is immediately usable.
    controller.newProject();

    setStatus("Resuming AudioContext on first user gesture...");
    resumeOnUserGesture(audioContext);

    setStatus("Ready.");
    const readyPayload: EngineReadyPayload = {
      crossOriginIsolated: window.crossOriginIsolated,
      audioContextState: audioContext.state,
      sampleRate: audioContext.sampleRate,
    };
    post(MessageType.EngineReady, readyPayload);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    setStatus(`Error: ${message}`);
    const errorPayload: EngineErrorPayload = { message, stack };
    post(MessageType.EngineError, errorPayload);
  }
}

function resumeOnUserGesture(audioContext: AudioContext) {
  const resume = async () => {
    if (audioContext.state === "suspended") {
      try {
        await audioContext.resume();
      } catch (error: unknown) {
        console.warn("Could not resume AudioContext:", error);
      }
    }
  };
  window.addEventListener("click", resume, { once: true });
  window.addEventListener("keydown", resume, { once: true });
}

window.addEventListener("message", async (event) => {
  if (!isEngineMessage(event.data)) return;
  const message = event.data as Message;
  if (message.direction !== "host-to-engine") return;
  if (message.projectId !== projectId) return;

  if (!controller) {
    post(MessageType.EngineError, {
      message: "Engine controller is not initialized",
    });
    return;
  }

  try {
    const result = await handleMessage(controller, message);
    if (result.type === "error") {
      post(MessageType.EngineError, { message: result.message });
    } else if (message.type !== MessageType.StateGet) {
      // Optionally echo a completion event back to the host for operations
      // that require an explicit ack. StateGet is handled directly by result.
      post(`${message.type}.ack`, result.payload ?? {});
    }
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    post(MessageType.EngineError, { message: messageText, stack });
  }
});

boot();
