import { Headphones, Mic, Volume2, VolumeX } from "lucide-react";
import type * as React from "react";
import type { TrackState } from "../../views/shared/types.js";

export interface TrackHeaderProps {
  track: TrackState;
  onMute: () => void;
  onSolo: () => void;
  onArm: () => void;
  onVolume: (volume: number) => void;
  onPan: (pan: number) => void;
  onName: (name: string) => void;
}

export const TrackHeader: React.FC<TrackHeaderProps> = ({
  track,
  onMute,
  onSolo,
  onArm,
  onVolume,
  onPan,
  onName,
}) => {
  return (
    <div
      role="rowheader"
      aria-label={`Track ${track.name}`}
      style={{
        width: 180,
        minWidth: 180,
        height: track.height,
        padding: "4px 6px",
        borderRight: "1px solid var(--vsdaw-border)",
        borderBottom: "1px solid var(--vsdaw-border)",
        backgroundColor: "var(--vsdaw-panel-bg)",
        display: "flex",
        flexDirection: "column",
        gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 2,
            backgroundColor: track.color,
            flexShrink: 0,
          }}
        />
        <input
          aria-label="Track name"
          value={track.name}
          onChange={(e) => onName(e.target.value)}
          style={{
            flex: 1,
            background: "transparent",
            border: "1px solid transparent",
            color: "inherit",
            fontSize: "inherit",
            padding: "1px 4px",
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = "var(--vsdaw-input-border)")}
          onBlur={(e) => (e.currentTarget.style.borderColor = "transparent")}
        />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
        <TrackButton
          ariaLabel="Mute"
          active={track.muted}
          onClick={onMute}
          color="var(--vsdaw-warning)"
        >
          {track.muted ? <VolumeX size={12} /> : <Volume2 size={12} />}
        </TrackButton>
        <TrackButton
          ariaLabel="Solo"
          active={track.soloed}
          onClick={onSolo}
          color="var(--vsdaw-button-bg)"
        >
          S
        </TrackButton>
        <TrackButton
          ariaLabel="Arm"
          active={track.armed}
          onClick={onArm}
          color="var(--vsdaw-error)"
        >
          <Mic size={12} />
        </TrackButton>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: "auto" }}>
        <label style={{ fontSize: 10, opacity: 0.8 }}>VOL</label>
        <input
          aria-label="Volume"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={track.volume}
          onChange={(e) => onVolume(Number.parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "var(--vsdaw-button-bg)" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <label style={{ fontSize: 10, opacity: 0.8 }}>PAN</label>
        <input
          aria-label="Pan"
          type="range"
          min={-1}
          max={1}
          step={0.01}
          value={track.pan}
          onChange={(e) => onPan(Number.parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: "var(--vsdaw-button-bg)" }}
        />
      </div>
    </div>
  );
};

const TrackButton: React.FC<{
  ariaLabel: string;
  active: boolean;
  onClick: () => void;
  color: string;
  children: React.ReactNode;
}> = ({ ariaLabel, active, onClick, color, children }) => (
  <button
    aria-label={ariaLabel}
    aria-pressed={active}
    onClick={onClick}
    style={{
      width: 22,
      height: 22,
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      border: "1px solid var(--vsdaw-border)",
      borderRadius: 3,
      backgroundColor: active ? color : "transparent",
      color: active ? "var(--vsdaw-button-fg)" : "inherit",
      cursor: "pointer",
      fontSize: 10,
      fontWeight: 700,
    }}
  >
    {children}
  </button>
);
