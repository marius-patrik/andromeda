import type * as React from "react";
import { createRoot } from "react-dom/client";
import { MixerStrip } from "../../components/mixer/MixerStrip.js";
import { PanelShell } from "../../components/shared/PanelShell.js";
import { ThemeProvider } from "../../components/shared/ThemeProvider.js";
import { Toolbar } from "../../components/shared/Toolbar.js";
import type { TrackState } from "../shared/types.js";
import { useViewState } from "../shared/useViewState.js";

const masterTrack = (
  tracks: import("../shared/types.js").TrackState[],
): import("../shared/types.js").TrackState => ({
  id: "master",
  name: "Master",
  color: "#f0f0f0",
  muted: false,
  soloed: false,
  armed: false,
  volume: 0.8,
  pan: 0,
  height: 0,
  regions: [],
});

const MixerView: React.FC = () => {
  const state = useViewState("mixer");

  return (
    <ThemeProvider>
      <PanelShell>
        <Toolbar
          view="Mixer"
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
        <div
          role="group"
          aria-label="Mixer channels"
          style={{ flex: 1, display: "flex", overflowX: "auto", overflowY: "hidden" }}
        >
          {state.tracks.map((track: TrackState) => (
            <MixerStrip
              key={track.id}
              track={track}
              onMute={() => state.trackActions.setMute(track.id, !track.muted)}
              onSolo={() => state.trackActions.setSolo(track.id, !track.soloed)}
              onArm={() => state.trackActions.setArm(track.id, !track.armed)}
              onVolume={(v: number) => state.trackActions.setVolume(track.id, v)}
              onPan={(p: number) => state.trackActions.setPan(track.id, p)}
              onOpenInsert={(slot: number) => state.mixerActions.openDevice(track.id, slot)}
            />
          ))}
          <MixerStrip
            track={masterTrack(state.tracks)}
            isMaster
            onMute={() => {}}
            onSolo={() => {}}
            onArm={() => {}}
            onVolume={() => {}}
            onPan={() => {}}
            onOpenInsert={() => {}}
          />
        </div>
      </PanelShell>
    </ThemeProvider>
  );
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<MixerView />);
