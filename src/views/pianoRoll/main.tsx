import * as React from "react";
import { createRoot } from "react-dom/client";
import { PianoRollGrid } from "../../components/pianoRoll/PianoRollGrid.js";
import { VelocityLane } from "../../components/pianoRoll/VelocityLane.js";
import { PanelShell } from "../../components/shared/PanelShell.js";
import { ThemeProvider } from "../../components/shared/ThemeProvider.js";
import { Toolbar } from "../../components/shared/Toolbar.js";
import type { NoteState } from "../shared/types.js";
import { useViewState } from "../shared/useViewState.js";

const PianoRollView: React.FC = () => {
  const state = useViewState("pianoRoll");
  const [notes, setNotes] = React.useState<NoteState[]>([]);
  const [snap, setSnap] = React.useState<Parameters<typeof PianoRollGrid>[0]["snap"]>("beat");

  // Demo notes until host starts sending authoritative note data.
  React.useEffect(() => {
    if (notes.length === 0) {
      setNotes([
        { id: "n1", start: 0, duration: 1, pitch: 60, velocity: 100 },
        { id: "n2", start: 1, duration: 1, pitch: 62, velocity: 80 },
        { id: "n3", start: 2, duration: 1, pitch: 64, velocity: 110 },
      ]);
    }
  }, [notes.length]);

  const addNote = (note: Omit<NoteState, "id">) => {
    const id = `n-${Date.now()}`;
    setNotes((prev) => [...prev, { ...note, id }]);
    state.send({ type: "pianoRoll/addNote", note: { ...note, id } });
  };

  const moveNote = (id: string, start: number, pitch: number) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, start, pitch } : n)));
  };

  const resizeNote = (id: string, duration: number) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, duration } : n)));
  };

  const setVelocity = (id: string, velocity: number) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, velocity } : n)));
    state.send({ type: "pianoRoll/setNoteVelocity", noteId: id, velocity });
  };

  const deleteNote = (id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    state.send({ type: "pianoRoll/deleteNote", noteId: id });
  };

  return (
    <ThemeProvider>
      <PanelShell>
        <Toolbar
          view="Piano Roll"
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
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "4px 8px",
            borderBottom: "1px solid var(--vsdaw-border)",
          }}
        >
          <label style={{ fontSize: 11 }}>Snap</label>
          <select
            aria-label="Snap mode"
            value={snap}
            onChange={(e) => setSnap(e.target.value as typeof snap)}
            style={{
              backgroundColor: "var(--vsdaw-input-bg)",
              color: "inherit",
              border: "1px solid var(--vsdaw-input-border)",
              borderRadius: 4,
              padding: "2px 6px",
            }}
          >
            <option value="off">Off</option>
            <option value="1/4">1/4 beat</option>
            <option value="1/2">1/2 beat</option>
            <option value="beat">Beat</option>
            <option value="bar">Bar</option>
          </select>
        </div>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ flex: 1, overflow: "auto" }}>
            <PianoRollGrid
              notes={notes}
              snap={snap}
              onAddNote={addNote}
              onMoveNote={moveNote}
              onResizeNote={resizeNote}
              onDeleteNote={deleteNote}
            />
          </div>
          <VelocityLane notes={notes} onSetVelocity={setVelocity} />
        </div>
      </PanelShell>
    </ThemeProvider>
  );
};

const root = document.getElementById("root");
if (root) createRoot(root).render(<PianoRollView />);
