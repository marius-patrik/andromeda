import * as React from "react";
import { createRoot } from "react-dom/client";
import { PanelShell } from "../../components/shared/PanelShell.js";
import { ThemeProvider } from "../../components/shared/ThemeProvider.js";
import { Toolbar } from "../../components/shared/Toolbar.js";
import { TimelineCanvas } from "../../components/timeline/TimelineCanvas.js";
import { TrackHeader } from "../../components/timeline/TrackHeader.js";
import type { TrackState } from "../shared/types.js";
import { useViewState } from "../shared/useViewState.js";

const TimelineView: React.FC = () => {
  const state = useViewState("timeline");

  React.useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case " ":
          e.preventDefault();
          state.isPlaying ? state.transport.pause() : state.transport.play();
          break;
        case "Delete":
        case "Backspace":
          state.commands.delete();
          break;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
        e.preventDefault();
        state.commands.duplicate();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [state]);

  return (
    <ThemeProvider>
      <PanelShell>
        <Toolbar
          view="Timeline"
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
        <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
          <div role="rowgroup" aria-label="Track headers" style={{ overflowY: "auto" }}>
            <div style={{ height: 48, borderBottom: "1px solid var(--vsdaw-border)" }} />
            {state.tracks.map((track: TrackState) => (
              <TrackHeader
                key={track.id}
                track={track}
                onMute={() => state.trackActions.setMute(track.id, !track.muted)}
                onSolo={() => state.trackActions.setSolo(track.id, !track.soloed)}
                onArm={() => state.trackActions.setArm(track.id, !track.armed)}
                onVolume={(v: number) => state.trackActions.setVolume(track.id, v)}
                onPan={(p: number) => state.trackActions.setPan(track.id, p)}
                onName={(n: string) => state.trackActions.setName(track.id, n)}
              />
            ))}
          </div>
          <TimelineCanvas
            tracks={state.tracks}
            positionBeats={
              state.position.bars * 4 + state.position.beats - 1 + state.position.ticks / 960
            }
            loopStart={0}
            loopEnd={16}
            onSeek={(_beats: number) => {
              // Transport seeks are handled by the host; we only send coarse seeks if needed.
              // For now the host owns precise transport position.
            }}
            onSelectRegion={state.timelineActions.selectRegion}
            onMoveRegion={state.timelineActions.moveRegion}
          />
        </div>
      </PanelShell>
    </ThemeProvider>
  );
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<TimelineView />);
