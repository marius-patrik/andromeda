import type * as React from "react";
import { createRoot } from "react-dom/client";
import { BrowserTree } from "../../components/browser/BrowserTree.js";
import { PanelShell } from "../../components/shared/PanelShell.js";
import { ThemeProvider } from "../../components/shared/ThemeProvider.js";
import { Toolbar } from "../../components/shared/Toolbar.js";
import type { BrowserNode } from "../shared/types.js";
import { useViewState } from "../shared/useViewState.js";

const defaultBrowserRoot: BrowserNode = {
  id: "root",
  name: "Browser",
  type: "folder",
  children: [
    {
      id: "devices",
      name: "Devices",
      type: "folder",
      children: [
        {
          id: "devices-instruments",
          name: "Instruments",
          type: "folder",
          children: [
            {
              id: "dev-synth",
              name: "OpenDAW Synth",
              type: "device",
              device: { id: "synth", name: "OpenDAW Synth", category: "instrument" },
            },
            {
              id: "dev-sampler",
              name: "OpenDAW Sampler",
              type: "device",
              device: { id: "sampler", name: "OpenDAW Sampler", category: "instrument" },
            },
          ],
        },
        {
          id: "devices-effects",
          name: "Effects",
          type: "folder",
          children: [
            {
              id: "dev-eq",
              name: "OpenDAW EQ",
              type: "device",
              device: { id: "eq", name: "OpenDAW EQ", category: "effect" },
            },
            {
              id: "dev-comp",
              name: "OpenDAW Compressor",
              type: "device",
              device: { id: "comp", name: "OpenDAW Compressor", category: "effect" },
            },
          ],
        },
        {
          id: "devices-utilities",
          name: "Utilities",
          type: "folder",
          children: [
            {
              id: "dev-gain",
              name: "Gain",
              type: "device",
              device: { id: "gain", name: "Gain", category: "utility" },
            },
          ],
        },
      ],
    },
    {
      id: "workspace",
      name: "Workspace Samples",
      type: "folder",
      children: [
        { id: "ws-kick", name: "kick.wav", type: "file" },
        { id: "ws-snare", name: "snare.wav", type: "file" },
      ],
    },
    {
      id: "project",
      name: "Project Samples",
      type: "folder",
      children: [],
    },
  ],
};

const BrowserView: React.FC = () => {
  const state = useViewState("browser");
  const root = state.browserRoot ?? defaultBrowserRoot;

  return (
    <ThemeProvider>
      <PanelShell>
        <Toolbar
          view="Browser"
          projectName={state.projectName}
          saved={state.saved}
          isPlaying={state.isPlaying}
          isRecording={state.isRecording}
          isLooping={state.isLooping}
          isMetronomeEnabled={state.isMetronomeEnabled}
          position={state.position}
          bpm={state.bpm}
          timeSignature={state.timeSignature}
          onPlay={state.transport.play}
          onPause={state.transport.pause}
          onStop={state.transport.stop}
          onRecord={state.transport.record}
          onToggleLoop={state.transport.toggleLoop}
          onToggleMetronome={state.transport.toggleMetronome}
          onSetTempo={state.transport.setTempo}
          onSetTimeSignature={state.transport.setTimeSignature}
          onShowView={state.commands.showView}
          onSettings={() => state.commands.showView("browser")}
          onExport={state.commands.export}
        />
        <BrowserTree
          root={root}
          onPreview={state.browserActions.preview}
          onDragStart={state.browserActions.dragStart}
        />
      </PanelShell>
    </ThemeProvider>
  );
};

const rootEl = document.getElementById("root");
if (rootEl) createRoot(rootEl).render(<BrowserView />);
