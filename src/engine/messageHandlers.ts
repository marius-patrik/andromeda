import {
  type DeviceCreatePayload,
  type DeviceIdPayload,
  type DeviceMovePayload,
  type DeviceParameterPayload,
  type ExportRenderPayload,
  type Message,
  MessageType,
  type MidiAddNotePayload,
  type MidiInputPayload,
  type MidiMoveNotePayload,
  type MidiNoteIdPayload,
  type MidiNoteVelocityPayload,
  type MidiResizeNotePayload,
  type PeaksGetPayload,
  type ProjectLoadPayload,
  type ProjectNewPayload,
  type ProjectSavePayload,
  type RecordingCompPayload,
  type RecordingStartPayload,
  type RegionCreateAudioPayload,
  type RegionCreateMidiPayload,
  type RegionFadePayload,
  type RegionIdPayload,
  type RegionMovePayload,
  type RegionResizePayload,
  type RegionSplitPayload,
  type TrackBooleanPayload,
  type TrackColorPayload,
  type TrackCreatePayload,
  type TrackIdPayload,
  type TrackInsertMovePayload,
  type TrackInsertPayload,
  type TrackInsertRemovePayload,
  type TrackNamePayload,
  type TrackPanPayload,
  type TrackReorderPayload,
  type TrackVolumePayload,
  type TransportLoopPayload,
  type TransportSeekPayload,
  type TransportTempoPayload,
  type TransportTimeSignaturePayload,
} from "../shared/protocol.js";
import type { ProjectController } from "./projectAdapter.js";

export type HandlerResult = { type: "ok"; payload?: unknown } | { type: "error"; message: string };

export function handleMessage(
  controller: ProjectController,
  message: Message,
): Promise<HandlerResult> | HandlerResult {
  try {
    return routeMessage(controller, message);
  } catch (error: unknown) {
    const messageText = error instanceof Error ? error.message : String(error);
    return { type: "error", message: messageText };
  }
}

function routeMessage(
  controller: ProjectController,
  message: Message,
): Promise<HandlerResult> | HandlerResult {
  const p = message.payload;
  switch (message.type) {
    // Project lifecycle
    case MessageType.ProjectNew: {
      const opts = p as ProjectNewPayload;
      controller.newProject(opts.bpm, opts.timeSignature);
      return { type: "ok" };
    }
    case MessageType.ProjectLoad: {
      const opts = p as ProjectLoadPayload;
      const binary = base64ToArrayBuffer(opts.data);
      controller.loadProject(binary);
      return { type: "ok" };
    }
    case MessageType.ProjectSave: {
      const opts = p as ProjectSavePayload;
      const buffer = controller.serializeProject();
      if (opts.format === "arraybuffer") {
        return { type: "ok", payload: buffer };
      }
      return { type: "ok", payload: arrayBufferToBase64(buffer) };
    }
    case MessageType.ProjectClose: {
      controller.closeProject();
      return { type: "ok" };
    }

    // Transport
    case MessageType.TransportPlay:
      controller.play();
      return { type: "ok" };
    case MessageType.TransportPause:
      controller.pause();
      return { type: "ok" };
    case MessageType.TransportStop:
      controller.stop();
      return { type: "ok" };
    case MessageType.TransportRecord:
      controller.record();
      return { type: "ok" };
    case MessageType.TransportSeek: {
      const opts = p as TransportSeekPayload;
      controller.seek(opts.position, opts.unit);
      return { type: "ok" };
    }
    case MessageType.TransportSetLoop: {
      const opts = p as TransportLoopPayload;
      controller.setLoop(opts.enabled, opts.start, opts.end);
      return { type: "ok" };
    }
    case MessageType.TransportSetTempo: {
      const opts = p as TransportTempoPayload;
      controller.setTempo(opts.bpm);
      return { type: "ok" };
    }
    case MessageType.TransportSetTimeSignature: {
      const opts = p as TransportTimeSignaturePayload;
      controller.setTimeSignature(opts.numerator, opts.denominator);
      return { type: "ok" };
    }

    // Tracks
    case MessageType.TrackCreate: {
      const opts = p as TrackCreatePayload;
      const id = controller.createTrack(opts.type, opts.name, opts.index, opts.color);
      return { type: "ok", payload: { trackId: id } };
    }
    case MessageType.TrackDelete: {
      const opts = p as TrackIdPayload;
      controller.deleteTrack(opts.trackId);
      return { type: "ok" };
    }
    case MessageType.TrackReorder: {
      const opts = p as TrackReorderPayload;
      controller.reorderTrack(opts.trackId, opts.newIndex);
      return { type: "ok" };
    }
    case MessageType.TrackSetName: {
      const opts = p as TrackNamePayload;
      controller.setTrackName(opts.trackId, opts.name);
      return { type: "ok" };
    }
    case MessageType.TrackSetColor: {
      const opts = p as TrackColorPayload;
      controller.setTrackColor(opts.trackId, opts.color);
      return { type: "ok" };
    }
    case MessageType.TrackSetVolumeDb: {
      const opts = p as TrackVolumePayload;
      controller.setTrackVolumeDb(opts.trackId, opts.volumeDb);
      return { type: "ok" };
    }
    case MessageType.TrackSetPan: {
      const opts = p as TrackPanPayload;
      controller.setTrackPan(opts.trackId, opts.pan);
      return { type: "ok" };
    }
    case MessageType.TrackSetMute: {
      const opts = p as TrackBooleanPayload;
      controller.setTrackMute(opts.trackId, opts.value);
      return { type: "ok" };
    }
    case MessageType.TrackSetSolo: {
      const opts = p as TrackBooleanPayload;
      controller.setTrackSolo(opts.trackId, opts.value);
      return { type: "ok" };
    }
    case MessageType.TrackSetArm: {
      const opts = p as TrackBooleanPayload;
      controller.setTrackArm(opts.trackId, opts.value);
      return { type: "ok" };
    }
    case MessageType.TrackAddInsert: {
      const opts = p as TrackInsertPayload;
      const id = controller.createDevice(
        "audio-effect",
        opts.deviceName,
        opts.trackId,
        opts.insertIndex,
      );
      return { type: "ok", payload: { insertId: id } };
    }
    case MessageType.TrackRemoveInsert: {
      const opts = p as TrackInsertRemovePayload;
      controller.deleteDevice(opts.insertId);
      return { type: "ok" };
    }
    case MessageType.TrackMoveInsert: {
      const opts = p as TrackInsertMovePayload;
      controller.moveDevice(opts.insertId, opts.newIndex);
      return { type: "ok" };
    }
    case MessageType.TrackSetInsertParameter: {
      const opts = p as DeviceParameterPayload;
      controller.setDeviceParameter(opts.deviceId, opts.parameter, opts.value);
      return { type: "ok" };
    }

    // Regions
    case MessageType.RegionCreateAudio: {
      const opts = p as RegionCreateAudioPayload;
      // The host must have imported the audio file first and pass the sample record.
      // For the protocol we accept a serialized sample object in the payload.
      const sample = (p as any).sample ?? {
        uuid: opts.audioFileId,
        name: opts.name ?? "audio",
        duration: opts.duration ?? 0,
        bpm: 120,
      };
      const id = controller.createAudioRegion(
        opts.trackId,
        sample,
        opts.position,
        opts.duration,
        opts.offset,
        opts.name,
      );
      return { type: "ok", payload: { regionId: id } };
    }
    case MessageType.RegionCreateMidi: {
      const opts = p as RegionCreateMidiPayload;
      const id = controller.createMidiRegion(opts.trackId, opts.position, opts.duration, opts.name);
      return { type: "ok", payload: { regionId: id } };
    }
    case MessageType.RegionMove: {
      const opts = p as RegionMovePayload;
      controller.moveRegion(opts.regionId, opts.position, opts.trackId);
      return { type: "ok" };
    }
    case MessageType.RegionResize: {
      const opts = p as RegionResizePayload;
      controller.resizeRegion(opts.regionId, opts.duration);
      return { type: "ok" };
    }
    case MessageType.RegionSplit: {
      const opts = p as RegionSplitPayload;
      const ids = controller.splitRegion(opts.regionId, opts.position);
      return { type: "ok", payload: { regionIds: ids } };
    }
    case MessageType.RegionSetFadeIn: {
      const opts = p as RegionFadePayload;
      controller.setFadeIn(opts.regionId, opts.value);
      return { type: "ok" };
    }
    case MessageType.RegionSetFadeOut: {
      const opts = p as RegionFadePayload;
      controller.setFadeOut(opts.regionId, opts.value);
      return { type: "ok" };
    }
    case MessageType.RegionDelete: {
      const opts = p as RegionIdPayload;
      controller.deleteRegion(opts.regionId);
      return { type: "ok" };
    }

    // MIDI
    case MessageType.MidiAddNote: {
      const opts = p as MidiAddNotePayload;
      const id = controller.addNote(
        opts.regionId,
        opts.position,
        opts.duration,
        opts.pitch,
        opts.velocity,
      );
      return { type: "ok", payload: { noteId: id } };
    }
    case MessageType.MidiMoveNote: {
      const opts = p as MidiMoveNotePayload;
      controller.moveNote(opts.noteId, opts.position, opts.pitch);
      return { type: "ok" };
    }
    case MessageType.MidiResizeNote: {
      const opts = p as MidiResizeNotePayload;
      controller.resizeNote(opts.noteId, opts.duration);
      return { type: "ok" };
    }
    case MessageType.MidiDeleteNote: {
      const opts = p as MidiNoteIdPayload;
      controller.deleteNote(opts.noteId);
      return { type: "ok" };
    }
    case MessageType.MidiSetNoteVelocity: {
      const opts = p as MidiNoteVelocityPayload;
      controller.setNoteVelocity(opts.noteId, opts.velocity);
      return { type: "ok" };
    }
    case MessageType.MidiInput: {
      const opts = p as MidiInputPayload;
      controller.handleMidiInput(
        opts.deviceId,
        new Uint8Array(opts.data),
        opts.timestamp ?? performance.now(),
      );
      return { type: "ok" };
    }

    // Recording
    case MessageType.RecordingStart: {
      const opts = p as RecordingStartPayload;
      return controller
        .startRecording(opts.trackIds, opts.countIn)
        .then(() => ({ type: "ok" as const }))
        .catch((error: unknown) => ({
          type: "error" as const,
          message: error instanceof Error ? error.message : String(error),
        }));
    }
    case MessageType.RecordingStop: {
      controller.stopRecording();
      return { type: "ok" };
    }
    case MessageType.RecordingComp: {
      const opts = p as RecordingCompPayload;
      controller.compTakes(opts.takeRegionIds, opts.activeRegionId);
      return { type: "ok" };
    }

    // Devices
    case MessageType.DeviceCreate: {
      const opts = p as DeviceCreatePayload;
      const id = controller.createDevice(
        opts.slot,
        opts.factoryName,
        opts.trackId,
        opts.insertIndex,
      );
      return { type: "ok", payload: { deviceId: id } };
    }
    case MessageType.DeviceDelete: {
      const opts = p as DeviceIdPayload;
      controller.deleteDevice(opts.deviceId);
      return { type: "ok" };
    }
    case MessageType.DeviceMove: {
      const opts = p as DeviceMovePayload;
      controller.moveDevice(opts.deviceId, opts.newIndex);
      return { type: "ok" };
    }
    case MessageType.DeviceSetParameter: {
      const opts = p as DeviceParameterPayload;
      controller.setDeviceParameter(opts.deviceId, opts.parameter, opts.value);
      return { type: "ok" };
    }

    // Peaks
    case MessageType.PeaksGet: {
      const opts = p as PeaksGetPayload;
      return controller
        .getPeaks(opts.sampleId, opts.width, opts.channel)
        .then((result) => ({ type: "ok" as const, payload: result }))
        .catch((error: unknown) => ({
          type: "error" as const,
          message: error instanceof Error ? error.message : String(error),
        }));
    }

    // Export
    case MessageType.ExportRender: {
      const opts = p as ExportRenderPayload;
      return controller
        .renderExport(opts.format, opts.start, opts.end, opts.fileName, opts.stems)
        .then((result) => ({ type: "ok" as const, payload: result }))
        .catch((error: unknown) => ({
          type: "error" as const,
          message: error instanceof Error ? error.message : String(error),
        }));
    }

    // State
    case MessageType.StateGet: {
      return { type: "ok", payload: controller.getState() };
    }

    default:
      return { type: "error", message: `Unknown message type: ${message.type}` };
  }
}

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}
