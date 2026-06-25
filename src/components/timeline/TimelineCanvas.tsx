import * as React from "react";
import type { TrackState } from "../../views/shared/types.js";

const BEAT_WIDTH = 40;
const HEADER_HEIGHT = 24;
const RULER_HEIGHT = 24;

export interface TimelineCanvasProps {
  tracks: TrackState[];
  positionBeats: number;
  loopStart: number;
  loopEnd: number;
  onSeek: (beats: number) => void;
  onSelectRegion: (regionId: string | null) => void;
  onMoveRegion: (regionId: string, start: number) => void;
}

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  tracks,
  positionBeats,
  loopStart,
  loopEnd,
  onSeek,
  onSelectRegion,
  onMoveRegion,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(1);
  const [scrollX, setScrollX] = React.useState(0);
  const [drag, setDrag] = React.useState<
    | { type: "seek"; startX: number }
    | { type: "region"; regionId: string; startBeats: number; startX: number }
    | null
  >(null);

  const width = typeof window !== "undefined" ? window.innerWidth : 800;

  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const styles = getComputedStyle(document.documentElement);
    const bg = styles.getPropertyValue("--vsdaw-bg").trim();
    const fg = styles.getPropertyValue("--vsdaw-fg").trim();
    const border = styles.getPropertyValue("--vsdaw-border").trim();
    const active = styles.getPropertyValue("--vsdaw-active-bg").trim();
    const button = styles.getPropertyValue("--vsdaw-button-bg").trim();

    // Background
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    const totalHeight = HEADER_HEIGHT + RULER_HEIGHT + tracks.reduce((sum, t) => sum + t.height, 0);
    if (canvas.height / dpr < totalHeight) {
      canvas.style.height = `${totalHeight}px`;
    }

    // Time ruler
    ctx.strokeStyle = border;
    ctx.lineWidth = 1;
    ctx.fillStyle = fg;
    ctx.font = "11px sans-serif";
    ctx.textBaseline = "middle";

    const visibleStart = scrollX / (BEAT_WIDTH * scale);
    const visibleBeats = rect.width / (BEAT_WIDTH * scale);
    const startBar = Math.floor(visibleStart / 4);
    const endBar = Math.ceil((visibleStart + visibleBeats) / 4);

    for (let bar = startBar; bar <= endBar; bar++) {
      const x = bar * 4 * BEAT_WIDTH * scale - scrollX;
      ctx.beginPath();
      ctx.moveTo(x, HEADER_HEIGHT);
      ctx.lineTo(x, HEADER_HEIGHT + RULER_HEIGHT);
      ctx.stroke();
      ctx.fillText(`B${bar + 1}`, x + 4, HEADER_HEIGHT + RULER_HEIGHT / 2);
      for (let beat = 1; beat < 4; beat++) {
        const bx = x + beat * BEAT_WIDTH * scale;
        ctx.beginPath();
        ctx.moveTo(bx, HEADER_HEIGHT + RULER_HEIGHT - 8);
        ctx.lineTo(bx, HEADER_HEIGHT + RULER_HEIGHT);
        ctx.stroke();
      }
    }

    // Loop markers
    const loopXs = [loopStart, loopEnd].map((b) => b * BEAT_WIDTH * scale - scrollX);
    ctx.fillStyle = button;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(loopXs[0], HEADER_HEIGHT + RULER_HEIGHT, loopXs[1] - loopXs[0], rect.height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = button;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(loopXs[0], HEADER_HEIGHT + RULER_HEIGHT);
    ctx.lineTo(loopXs[0], rect.height);
    ctx.moveTo(loopXs[1], HEADER_HEIGHT + RULER_HEIGHT);
    ctx.lineTo(loopXs[1], rect.height);
    ctx.stroke();
    ctx.setLineDash([]);

    // Tracks
    let y = HEADER_HEIGHT + RULER_HEIGHT;
    for (const track of tracks) {
      ctx.fillStyle = track.color;
      ctx.globalAlpha = 0.08;
      ctx.fillRect(0, y, rect.width, track.height);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = border;
      ctx.beginPath();
      ctx.moveTo(0, y + track.height);
      ctx.lineTo(rect.width, y + track.height);
      ctx.stroke();

      for (const region of track.regions) {
        const rx = region.start * BEAT_WIDTH * scale - scrollX;
        const rw = Math.max(2, region.duration * BEAT_WIDTH * scale);
        ctx.fillStyle = region.color || track.color;
        ctx.globalAlpha = 0.85;
        ctx.fillRect(rx + 1, y + 4, rw - 2, track.height - 8);
        ctx.globalAlpha = 1;
        ctx.fillStyle = fg;
        ctx.fillText(region.name, rx + 6, y + track.height / 2);
      }
      y += track.height;
    }

    // Playhead
    const px = positionBeats * BEAT_WIDTH * scale - scrollX;
    ctx.strokeStyle = active;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px, HEADER_HEIGHT + RULER_HEIGHT);
    ctx.lineTo(px, rect.height);
    ctx.stroke();
  }, [tracks, positionBeats, loopStart, loopEnd, scale, scrollX]);

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setScale((s) => Math.max(0.25, Math.min(4, s - e.deltaY * 0.001)));
    } else {
      setScrollX((x) => Math.max(0, x + e.deltaX));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left + scrollX;
    const beats = x / (BEAT_WIDTH * scale);

    if (e.shiftKey) {
      onSeek(beats);
      setDrag({ type: "seek", startX: e.clientX });
      return;
    }

    // Hit-test regions
    let y = HEADER_HEIGHT + RULER_HEIGHT;
    for (const track of tracks) {
      if (e.clientY - rect.top >= y && e.clientY - rect.top < y + track.height) {
        for (const region of track.regions) {
          const rx = region.start * BEAT_WIDTH * scale;
          const rw = Math.max(2, region.duration * BEAT_WIDTH * scale);
          if (x >= rx && x <= rx + rw) {
            onSelectRegion(region.id);
            setDrag({
              type: "region",
              regionId: region.id,
              startBeats: region.start,
              startX: e.clientX,
            });
            return;
          }
        }
      }
      y += track.height;
    }

    onSelectRegion(null);
    onSeek(beats);
    setDrag({ type: "seek", startX: e.clientX });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    if (drag.type === "seek") {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left + scrollX;
      const beats = x / (BEAT_WIDTH * scale);
      onSeek(Math.max(0, beats));
    } else if (drag.type === "region") {
      const deltaPixels = e.clientX - drag.startX;
      const deltaBeats = deltaPixels / (BEAT_WIDTH * scale);
      onMoveRegion(drag.regionId, Math.max(0, drag.startBeats + deltaBeats));
    }
  };

  const handleMouseUp = () => setDrag(null);

  return (
    <div
      ref={containerRef}
      onWheel={handleWheel}
      style={{ flex: 1, overflow: "auto", position: "relative" }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Timeline canvas"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{
          display: "block",
          width: `${width}px`,
          height: `${Math.max(
            300,
            HEADER_HEIGHT + RULER_HEIGHT + tracks.reduce((s, t) => s + t.height, 0),
          )}px`,
          cursor: drag ? "grabbing" : "default",
        }}
      />
    </div>
  );
};
