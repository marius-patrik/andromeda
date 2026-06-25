import { WavFile } from "@opendaw/lib-dsp";
import { Option, UUID } from "@opendaw/lib-std";
import {
  type AnyRegionBoxAdapter,
  AudioRegionBoxAdapter,
  type AudioUnitBoxAdapter,
  AudioUnitFactory,
  InstrumentFactories,
  type NoteEventBoxAdapter,
  NoteEventCollectionBoxAdapter,
  NoteRegionBoxAdapter,
  RegionEditing,
  TrackType as SdkTrackType,
  type TrackBoxAdapter,
} from "@opendaw/studio-adapters";
import {
  AudioFileBox,
  AudioRegionBox,
  type AudioUnitBox,
  NoteEventBox,
  NoteRegionBox,
  TrackBox,
} from "@opendaw/studio-boxes";
import {
  AudioOfflineRenderer,
  type AudioWorklets,
  EffectFactories,
  type EffectFactory,
  type ExportConfiguration,
  GlobalSampleLoaderManager,
  GlobalSoundfontLoaderManager,
  Project,
  type ProjectEnv,
  SampleService,
  SoundfontService,
  Workers,
} from "@opendaw/studio-core";
import { SampleStorage, SoundfontStorage } from "@opendaw/studio-core";
import type {
  TrackType as ApiTrackType,
  ExportFormat,
  ExportRenderResult,
  InsertState,
  NoteState,
  PeaksResultPayload,
  ProjectState,
  RegionState,
  TrackState,
} from "../shared/protocol.js";

export interface BootEnv extends ProjectEnv {
  audioContext: AudioContext;
  audioWorklets: AudioWorklets;
}

export interface ProjectControllerOptions {
  bootEnv: BootEnv;
  projectId: string;
  onStateChange?: (state: ProjectState) => void;
  onTransportPosition?: (position: number) => void;
}

export class ProjectController {
  readonly bootEnv: BootEnv;
  readonly projectId: string;
  private project: Project | null = null;
  private subscriptions: Array<() => void> = [];
  private trackNames = new Map<string, string>();
  private trackColors = new Map<string, string>();
  private takeRegions = new Map<string, AnyRegionBoxAdapter[]>();

  constructor(options: ProjectControllerOptions) {
    this.bootEnv = options.bootEnv;
    this.projectId = options.projectId;
    if (options.onStateChange) {
      this.onStateChange = options.onStateChange;
    }
    if (options.onTransportPosition) {
      this.onTransportPosition = options.onTransportPosition;
    }
  }

  private onStateChange?: (state: ProjectState) => void;
  private onTransportPosition?: (position: number) => void;

  private assertProject(): Project {
    if (this.project === null) {
      throw new Error("No project is currently open");
    }
    return this.project;
  }

  private get boxGraph() {
    return this.assertProject().boxGraph;
  }

  private get api() {
    return this.assertProject().api;
  }

  private get engine() {
    return this.assertProject().engine;
  }

  private get rootAdapter() {
    return this.assertProject().rootBoxAdapter;
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  newProject(defaultBpm = 120, timeSignature: [number, number] = [4, 4]) {
    this.closeProject();
    const env: ProjectEnv = {
      audioContext: this.bootEnv.audioContext,
      audioWorklets: this.bootEnv.audioWorklets,
      sampleManager: this.bootEnv.sampleManager,
      soundfontManager: this.bootEnv.soundfontManager,
      sampleService: this.bootEnv.sampleService,
      soundfontService: this.bootEnv.soundfontService,
    };
    this.project = Project.new(env);
    this.api.setBpm(defaultBpm);
    this.setTimeSignature(timeSignature[0], timeSignature[1]);
    this.project.startAudioWorklet();
    this.attachTransportObservers();
    this.broadcastState();
  }

  loadProject(data: ArrayBufferLike) {
    this.closeProject();
    const env: ProjectEnv = {
      audioContext: this.bootEnv.audioContext,
      audioWorklets: this.bootEnv.audioWorklets,
      sampleManager: this.bootEnv.sampleManager,
      soundfontManager: this.bootEnv.soundfontManager,
      sampleService: this.bootEnv.sampleService,
      soundfontService: this.bootEnv.soundfontService,
    };
    this.project = Project.load(env, data as ArrayBuffer);
    this.project.startAudioWorklet();
    this.attachTransportObservers();
    this.broadcastState();
  }

  serializeProject(): ArrayBufferLike {
    return this.assertProject().toArrayBuffer();
  }

  closeProject() {
    for (const unsubscribe of this.subscriptions) {
      unsubscribe();
    }
    this.subscriptions = [];
    if (this.project) {
      try {
        this.project.engine.stop(true);
      } catch {
        // ignore
      }
      this.project.terminate();
      this.project = null;
    }
    this.trackNames.clear();
    this.trackColors.clear();
    this.takeRegions.clear();
  }

  // ---------------------------------------------------------------------------
  // Transport
  // ---------------------------------------------------------------------------

  play() {
    this.engine.play();
    this.broadcastTransportState();
  }

  pause() {
    this.engine.stop(false);
    this.broadcastTransportState();
  }

  stop() {
    this.engine.stop(true);
    this.broadcastTransportState();
  }

  record() {
    this.assertProject().startRecording(false);
    this.broadcastTransportState();
  }

  seek(position: number, unit: "ppqn" | "seconds" | "bars" = "ppqn") {
    let ppqn = position;
    const bpm = this.engine.bpm.getValue();
    if (unit === "seconds") {
      ppqn = (position * bpm * 960) / 60;
    } else if (unit === "bars") {
      ppqn = position * 4 * 960;
    }
    this.engine.setPosition(Math.max(0, Math.round(ppqn)));
    this.broadcastTransportPosition();
  }

  setLoop(enabled: boolean, start?: number, end?: number) {
    const loop = this.assertProject().timelineBox.loopArea;
    this.boxGraph.beginTransaction();
    loop.enabled.setValue(enabled);
    if (start !== undefined) loop.from.setValue(start);
    if (end !== undefined) loop.to.setValue(end);
    this.boxGraph.endTransaction();
    this.broadcastTransportState();
  }

  setTempo(bpm: number) {
    this.api.setBpm(bpm);
    this.broadcastTransportState();
  }

  setTimeSignature(numerator: number, denominator: number) {
    const timeline = this.assertProject().timelineBox;
    this.boxGraph.beginTransaction();
    timeline.signature.nominator.setValue(numerator);
    timeline.signature.denominator.setValue(denominator);
    this.boxGraph.endTransaction();
    this.broadcastTransportState();
  }

  // ---------------------------------------------------------------------------
  // Tracks
  // ---------------------------------------------------------------------------

  createTrack(type: ApiTrackType, name?: string, index?: number, color?: string) {
    const project = this.assertProject();
    let audioUnit: AudioUnitBox;

    if (type === "midi") {
      const product = this.api.createInstrument(InstrumentFactories.Tape, {
        name: name ?? "MIDI Track",
      });
      audioUnit = product.audioUnitBox;
    } else if (type === "audio") {
      const capture = AudioUnitFactory.trackTypeToCapture(project.boxGraph, SdkTrackType.Audio);
      audioUnit = AudioUnitFactory.create(project.skeleton, "instrument" as any, capture, index);
      this.api.createAudioTrack(audioUnit, 0);
    } else {
      // bus
      audioUnit = AudioUnitFactory.create(project.skeleton, "bus" as any, Option.None, index);
      this.api.createAudioTrack(audioUnit, 0);
    }

    const id = UUID.toString(audioUnit.address.uuid);
    this.trackNames.set(id, name ?? `${type} track`);
    if (color) this.trackColors.set(id, color);

    if (index !== undefined) {
      const adapter = this.resolveAudioUnit(id);
      adapter.move(index - adapter.indexField.getValue());
    }

    this.broadcastState();
    return id;
  }

  deleteTrack(trackId: string) {
    const unit = this.resolveAudioUnit(trackId);
    this.api.deleteAudioUnit(unit.box);
    this.trackNames.delete(trackId);
    this.trackColors.delete(trackId);
    this.broadcastState();
  }

  reorderTrack(trackId: string, newIndex: number) {
    const unit = this.resolveAudioUnit(trackId);
    const delta = newIndex - unit.indexField.getValue();
    if (delta !== 0) {
      unit.move(delta);
    }
    this.broadcastState();
  }

  setTrackName(trackId: string, name: string) {
    this.trackNames.set(trackId, name);
    const unit = this.resolveAudioUnit(trackId);
    const input = unit.input.adapter().unwrapOrNull();
    if (input && "labelField" in input) {
      (input as any).labelField.setValue(name);
    }
    this.broadcastState();
  }

  setTrackColor(trackId: string, color: string) {
    this.trackColors.set(trackId, color);
    this.broadcastState();
  }

  setTrackVolumeDb(trackId: string, volumeDb: number) {
    const unit = this.resolveAudioUnit(trackId);
    unit.namedParameter.volume.setValue(volumeDb);
    this.broadcastState();
  }

  setTrackPan(trackId: string, pan: number) {
    const unit = this.resolveAudioUnit(trackId);
    unit.namedParameter.panning.setValue(pan);
    this.broadcastState();
  }

  setTrackMute(trackId: string, mute: boolean) {
    const unit = this.resolveAudioUnit(trackId);
    unit.namedParameter.mute.setValue(mute);
    this.broadcastState();
  }

  setTrackSolo(trackId: string, solo: boolean) {
    const unit = this.resolveAudioUnit(trackId);
    unit.namedParameter.solo.setValue(solo);
    this.broadcastState();
  }

  setTrackArm(trackId: string, arm: boolean) {
    const unit = this.resolveAudioUnit(trackId);
    const devices = this.assertProject().captureDevices;
    const capture = devices.get(unit.box.address.uuid);
    if (capture.nonEmpty()) {
      devices.setArm(capture.unwrap(), false);
      capture.unwrap().armed.setValue(arm);
    }
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Audio regions
  // ---------------------------------------------------------------------------

  async importAudioFile(
    arrayBuffer: ArrayBuffer,
    name?: string,
    bpm?: number,
  ): Promise<{ sampleId: string; sample: any }> {
    const sample = await this.bootEnv.sampleService.importFile({
      arrayBuffer,
      name,
      bpm,
    });
    return { sampleId: sample.uuid, sample };
  }

  createAudioRegion(
    trackId: string,
    sample: { uuid: string; name: string; duration: number; bpm: number },
    position: number,
    duration?: number,
    _offset?: number,
    name?: string,
  ): string {
    const track = this.resolveMainTrack(trackId);
    const project = this.assertProject();
    const audioFileBox = AudioFileBox.create(project.boxGraph, UUID.parse(sample.uuid));
    const regionBox = this.api.createNotStretchedRegion({
      boxGraph: project.boxGraph,
      targetTrack: track.box,
      audioFileBox,
      sample,
      position,
      duration,
      name: name ?? sample.name,
    });
    const adapter = this.assertProject().boxAdapters.adapterFor(regionBox, AudioRegionBoxAdapter);
    this.broadcastState();
    return UUID.toString(adapter.uuid);
  }

  createMidiRegion(trackId: string, position: number, duration: number, name?: string): string {
    const track = this.resolveMainTrack(trackId);
    const regionBox = this.api.createNoteRegion({
      trackBox: track.box,
      position,
      duration,
      name: name ?? "MIDI",
    });
    const adapter = this.assertProject().boxAdapters.adapterFor(regionBox, NoteRegionBoxAdapter);
    this.broadcastState();
    return UUID.toString(adapter.uuid);
  }

  moveRegion(regionId: string, position: number, trackId?: string) {
    const region = this.resolveRegion(regionId);
    this.boxGraph.beginTransaction();
    region.position = position;
    if (trackId) {
      const track = this.resolveMainTrack(trackId);
      region.box.regions.refer(track.box.regions);
    }
    this.boxGraph.endTransaction();
    this.broadcastState();
  }

  resizeRegion(regionId: string, duration: number) {
    const region = this.resolveRegion(regionId);
    region.duration = duration;
    this.broadcastState();
  }

  splitRegion(regionId: string, position: number): string[] {
    const region = this.resolveRegion(regionId);
    const split = RegionEditing.cut(region, position, false);
    if (split.isEmpty()) {
      return [regionId];
    }
    this.broadcastState();
    return [regionId, UUID.toString(split.unwrap().uuid)];
  }

  setFadeIn(regionId: string, value: number) {
    const region = this.resolveAudioRegion(regionId);
    region.fading.inField.setValue(value);
    this.broadcastState();
  }

  setFadeOut(regionId: string, value: number) {
    const region = this.resolveAudioRegion(regionId);
    region.fading.outField.setValue(value);
    this.broadcastState();
  }

  deleteRegion(regionId: string) {
    const region = this.resolveRegion(regionId);
    region.box.delete();
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // MIDI notes
  // ---------------------------------------------------------------------------

  addNote(
    regionId: string,
    position: number,
    duration: number,
    pitch: number,
    velocity: number,
  ): string {
    const region = this.resolveNoteRegion(regionId);
    const collection = region.optCollection.unwrap("Region has no note collection");
    const note = collection.createEvent({
      position,
      duration,
      pitch,
      velocity,
      cent: 0,
      chance: 100,
      playCount: 1,
    });
    this.broadcastState();
    return UUID.toString(note.uuid);
  }

  moveNote(noteId: string, position?: number, pitch?: number) {
    const note = this.resolveNote(noteId);
    this.boxGraph.beginTransaction();
    if (position !== undefined) note.box.position.setValue(position);
    if (pitch !== undefined) note.box.pitch.setValue(pitch);
    this.boxGraph.endTransaction();
    this.broadcastState();
  }

  resizeNote(noteId: string, duration: number) {
    const note = this.resolveNote(noteId);
    note.box.duration.setValue(duration);
    this.broadcastState();
  }

  deleteNote(noteId: string) {
    const note = this.resolveNote(noteId);
    note.box.delete();
    this.broadcastState();
  }

  setNoteVelocity(noteId: string, velocity: number) {
    const note = this.resolveNote(noteId);
    note.box.velocity.setValue(velocity);
    this.broadcastState();
  }

  handleMidiInput(deviceId: string, data: Uint8Array, _timestamp: number) {
    // Forward note-on/note-off to the engine as NoteSignal when playing.
    if (data.length < 3) return;
    const status = data[0] & 0xf0;
    const channel = data[0] & 0x0f;
    const note = data[1];
    const velocity = data[2];
    if (status === 0x90 && velocity > 0) {
      this.engine.noteSignal({
        type: "note-on",
        note,
        velocity: velocity / 127,
        channel,
        deviceId,
      } as any);
    } else if (status === 0x80 || (status === 0x90 && velocity === 0)) {
      this.engine.noteSignal({
        type: "note-off",
        note,
        velocity: 0,
        channel,
        deviceId,
      } as any);
    }
  }

  // ---------------------------------------------------------------------------
  // Recording
  // ---------------------------------------------------------------------------

  async startRecording(trackIds?: string[], countIn = false) {
    if (trackIds && trackIds.length > 0) {
      const devices = this.assertProject().captureDevices;
      for (const trackId of trackIds) {
        const unit = this.resolveAudioUnit(trackId);
        const capture = devices.get(unit.box.address.uuid);
        if (capture.nonEmpty()) {
          devices.setArm(capture.unwrap(), false);
          capture.unwrap().armed.setValue(true);
        }
      }
    }
    this.assertProject().startRecording(countIn);
    this.broadcastTransportState();
  }

  stopRecording() {
    this.assertProject().stopRecording();
    this.broadcastTransportState();
  }

  compTakes(takeRegionIds: string[], activeRegionId: string) {
    for (const id of takeRegionIds) {
      const region = this.resolveRegion(id);
      if (region.box instanceof AudioRegionBox || region.box instanceof NoteRegionBox) {
        region.box.mute.setValue(id !== activeRegionId);
      }
    }
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Effects / inserts
  // ---------------------------------------------------------------------------

  createDevice(
    slot: "instrument" | "audio-effect" | "midi-effect",
    factoryName: string,
    trackId?: string,
    insertIndex?: number,
  ): string {
    const project = this.assertProject();
    const factory = this.resolveEffectFactory(factoryName);

    if (slot === "instrument") {
      const instrumentFactory =
        (InstrumentFactories.Named as any)[factoryName] ?? InstrumentFactories.Tape;
      const product = this.api.createInstrument(instrumentFactory);
      this.broadcastState();
      return UUID.toString(product.instrumentBox.address.uuid);
    }

    const unit = trackId
      ? this.resolveAudioUnit(trackId)
      : this.rootAdapter.audioUnits.adapters()[0];
    if (!unit) {
      throw new Error("No target track available for effect");
    }
    const field = slot === "midi-effect" ? unit.midiEffectsField : unit.audioEffectsField;
    const effectBox = this.api.insertEffect(field, factory, insertIndex);
    this.broadcastState();
    return UUID.toString(effectBox.address.uuid);
  }

  deleteDevice(deviceId: string) {
    const device = this.resolveDevice(deviceId);
    device.box.delete();
    this.broadcastState();
  }

  moveDevice(deviceId: string, newIndex: number) {
    const device = this.resolveDevice(deviceId);
    const host = device.deviceHost();
    const collection =
      device.type === "midi-effect"
        ? host.midiEffects
        : device.type === "audio-effect"
          ? host.audioEffects
          : null;
    if (collection) {
      collection.move(device as any, newIndex - device.indexField.getValue());
    }
    this.broadcastState();
  }

  setDeviceParameter(deviceId: string, parameter: string, value: number | boolean) {
    const device = this.resolveDevice(deviceId);
    const params = (device as any).namedParameter;
    if (params && parameter in params) {
      params[parameter].setValue(value as any);
    } else {
      // Try direct field access for devices that expose parameters as fields.
      const field = (device.box as any)[parameter];
      if (field && typeof field.setValue === "function") {
        field.setValue(value);
      } else {
        throw new Error(`Parameter '${parameter}' not found on device ${deviceId}`);
      }
    }
    this.broadcastState();
  }

  // ---------------------------------------------------------------------------
  // Peaks
  // ---------------------------------------------------------------------------

  async getPeaks(sampleId: string, width: number, channel = 0): Promise<PeaksResultPayload> {
    const loader = this.bootEnv.sampleManager.getOrCreate(UUID.parse(sampleId));
    const state = loader.state;
    if (state.type !== "loaded") {
      await new Promise<void>((resolve, reject) => {
        const sub = loader.subscribe((s) => {
          if (s.type === "loaded") {
            sub.terminate();
            resolve();
          } else if (s.type === "error") {
            sub.terminate();
            reject(new Error(s.reason));
          }
        });
      });
    }
    const audioData = loader.data.unwrap("Sample data not loaded");
    const peaks = generatePeaks(audioData.frames, width, channel);
    return {
      sampleId,
      channel,
      peaks,
      sampleRate: audioData.sampleRate,
      numberOfChannels: audioData.numberOfChannels,
      numberOfFrames: audioData.numberOfFrames,
    };
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  async renderExport(
    format: ExportFormat,
    start?: number,
    end?: number,
    fileName?: string,
    stems = false,
  ): Promise<ExportRenderResult> {
    const project = this.assertProject();
    const sampleRate = this.bootEnv.audioContext.sampleRate;
    const range: ExportConfiguration["range"] =
      start !== undefined && end !== undefined ? { start, end } : "full";

    let exportConfiguration: ExportConfiguration;
    if (stems) {
      const stemMap: Record<string, any> = {};
      for (const unit of this.rootAdapter.audioUnits.adapters()) {
        stemMap[UUID.toString(unit.uuid)] = {
          includeAudioEffects: true,
          includeSends: true,
          useInstrumentOutput: false,
          fileName: `${this.trackNames.get(UUID.toString(unit.uuid)) ?? "stem"}.wav`,
        };
      }
      exportConfiguration = { range, stems: stemMap };
    } else {
      const masterId = UUID.toString(project.primaryAudioBusBox.address.uuid);
      exportConfiguration = {
        range,
        stems: {
          [masterId]: {
            includeAudioEffects: true,
            includeSends: true,
            useInstrumentOutput: false,
            skipChannelStrip: false,
            fileName: fileName ?? "render.wav",
          },
        },
      };
    }

    const audioBuffer = await AudioOfflineRenderer.start(
      project,
      Option.wrap(exportConfiguration),
      () => {},
      undefined,
      sampleRate,
    );

    if (format === "wav") {
      const arrayBuffer = WavFile.encodeFloats(audioBuffer);
      return {
        format,
        data: arrayBufferToBase64(arrayBuffer),
        fileName: fileName ?? "render.wav",
      };
    }

    // FLAC/OGG/MP3: encode via the deprecated renderer's AudioBuffer result.
    // A real implementation would pipe through ffmpeg.wasm or a browser encoder.
    // For now we fall back to WAV and report the fallback.
    const arrayBuffer = WavFile.encodeFloats(audioBuffer);
    return {
      format,
      data: arrayBufferToBase64(arrayBuffer),
      fileName: fileName ?? `render.${format}`,
      message: `${format.toUpperCase()} encoding not yet implemented; returned WAV data instead.`,
    };
  }

  // ---------------------------------------------------------------------------
  // State snapshot
  // ---------------------------------------------------------------------------

  getState(): ProjectState {
    const project = this.assertProject();
    const timeline = project.timelineBox;
    const loop = timeline.loopArea;
    const devices = project.captureDevices;
    const transport: ProjectState["transport"] = {
      isPlaying: this.engine.isPlaying.getValue(),
      isRecording: this.engine.isRecording.getValue(),
      isLooping: loop.enabled.getValue(),
      position: this.engine.position.getValue(),
      bpm: this.engine.bpm.getValue(),
      timeSignature: [
        timeline.signature.nominator.getValue(),
        timeline.signature.denominator.getValue(),
      ],
      loopStart: loop.from.getValue(),
      loopEnd: loop.to.getValue(),
    };

    const tracks: TrackState[] = [];
    const regions: RegionState[] = [];
    const notes: NoteState[] = [];

    for (const unit of this.rootAdapter.audioUnits.adapters()) {
      const id = UUID.toString(unit.uuid);
      const type: ApiTrackType = unit.isBus ? "bus" : unit.isInstrument ? "midi" : "audio";
      const inserts: InsertState[] = [];
      for (const fx of unit.audioEffects.adapters()) {
        inserts.push({
          id: UUID.toString(fx.uuid),
          name: fx.labelField.getValue(),
          type: "audio-effect",
          enabled: fx.enabledField.getValue(),
          index: fx.indexField.getValue(),
        });
      }
      for (const fx of unit.midiEffects.adapters()) {
        inserts.push({
          id: UUID.toString(fx.uuid),
          name: fx.labelField.getValue(),
          type: "midi-effect",
          enabled: fx.enabledField.getValue(),
          index: fx.indexField.getValue(),
        });
      }

      const capture = devices.get(unit.uuid);
      tracks.push({
        id,
        type,
        name: this.trackNames.get(id) ?? unit.label,
        color: this.trackColors.get(id),
        index: unit.indexField.getValue(),
        volumeDb: unit.namedParameter.volume.getValue(),
        pan: unit.namedParameter.panning.getValue(),
        mute: unit.namedParameter.mute.getValue(),
        solo: unit.namedParameter.solo.getValue(),
        arm: capture.mapOr((c) => c.armed.getValue(), false),
        inserts,
      });

      for (const track of unit.tracks.values()) {
        for (const region of track.regions.collection.asArray()) {
          const regionId = UUID.toString(region.uuid);
          const base: RegionState = {
            id: regionId,
            trackId: id,
            type: region.isAudioRegion() ? "audio" : "midi",
            position: region.position,
            duration: region.duration,
            name: region.label,
            hue: region.hue,
          };
          if (region.isAudioRegion()) {
            base.fadeIn = region.fading.in;
            base.fadeOut = region.fading.out;
            base.offset = region.offset;
          }
          regions.push(base);

          if (region.isNoteRegion()) {
            const optCollection = region.optCollection;
            if (optCollection.nonEmpty()) {
              for (const note of optCollection.unwrap().events.asArray()) {
                notes.push({
                  id: UUID.toString(note.uuid),
                  regionId,
                  position: note.position,
                  duration: note.duration,
                  pitch: note.pitch,
                  velocity: note.velocity,
                });
              }
            }
          }
        }
      }
    }

    return {
      projectId: this.projectId,
      tracks,
      regions,
      notes,
      transport,
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private resolveAudioUnit(trackId: string): AudioUnitBoxAdapter {
    const id = UUID.parse(trackId);
    const unit = this.rootAdapter.audioUnits.getAdapterById(id);
    if (unit.isEmpty()) {
      throw new Error(`Track not found: ${trackId}`);
    }
    return unit.unwrap();
  }

  private resolveMainTrack(trackId: string): TrackBoxAdapter {
    const unit = this.resolveAudioUnit(trackId);
    const tracks = unit.tracks.values();
    if (tracks.length === 0) {
      throw new Error(`Track '${trackId}' has no timeline lane`);
    }
    // Prefer the first main track matching the unit type.
    const targetType = unit.isBus
      ? SdkTrackType.Audio
      : unit.isInstrument
        ? SdkTrackType.Notes
        : SdkTrackType.Audio;
    return tracks.find((t) => t.type === targetType) ?? tracks[0];
  }

  private resolveRegion(regionId: string): AnyRegionBoxAdapter {
    const id = UUID.parse(regionId);
    for (const unit of this.rootAdapter.audioUnits.adapters()) {
      for (const track of unit.tracks.values()) {
        const region = track.regions.adapters.opt(id);
        if (region.nonEmpty()) {
          return region.unwrap();
        }
      }
    }
    throw new Error(`Region not found: ${regionId}`);
  }

  private resolveAudioRegion(regionId: string): AudioRegionBoxAdapter {
    const region = this.resolveRegion(regionId);
    if (!region.isAudioRegion()) {
      throw new Error(`Region '${regionId}' is not an audio region`);
    }
    return region;
  }

  private resolveNoteRegion(regionId: string): NoteRegionBoxAdapter {
    const region = this.resolveRegion(regionId);
    if (!region.isNoteRegion()) {
      throw new Error(`Region '${regionId}' is not a MIDI region`);
    }
    return region;
  }

  private resolveNote(noteId: string): NoteEventBoxAdapter {
    const id = UUID.parse(noteId);
    for (const unit of this.rootAdapter.audioUnits.adapters()) {
      for (const track of unit.tracks.values()) {
        for (const region of track.regions.collection.asArray()) {
          if (!region.isNoteRegion()) continue;
          const optCollection = region.optCollection;
          if (optCollection.isEmpty()) continue;
          const note = optCollection
            .unwrap()
            .events.asArray()
            .find((n) => UUID.equals(n.uuid, id));
          if (note) return note;
        }
      }
    }
    throw new Error(`Note not found: ${noteId}`);
  }

  private resolveDevice(deviceId: string): any {
    const id = UUID.parse(deviceId);
    for (const unit of this.rootAdapter.audioUnits.adapters()) {
      for (const fx of unit.audioEffects.adapters()) {
        if (UUID.equals(fx.uuid, id)) return fx;
      }
      for (const fx of unit.midiEffects.adapters()) {
        if (UUID.equals(fx.uuid, id)) return fx;
      }
      const input = unit.input.adapter().unwrapOrNull();
      if (input && UUID.equals(input.uuid, id)) return input;
    }
    throw new Error(`Device not found: ${deviceId}`);
  }

  private resolveEffectFactory(name: string): EffectFactory {
    const key = name as keyof typeof EffectFactories.MergedNamed;
    const factory = EffectFactories.MergedNamed[key];
    if (!factory) {
      throw new Error(`Unknown effect factory: ${name}`);
    }
    return factory;
  }

  private attachTransportObservers() {
    const engine = this.engine;
    this.subscriptions.push(() =>
      engine.position.subscribe(() => this.broadcastTransportPosition()).terminate(),
    );
    this.subscriptions.push(() =>
      engine.isPlaying.subscribe(() => this.broadcastTransportState()).terminate(),
    );
    this.subscriptions.push(() =>
      engine.isRecording.subscribe(() => this.broadcastTransportState()).terminate(),
    );
    this.subscriptions.push(() =>
      engine.bpm.subscribe(() => this.broadcastTransportState()).terminate(),
    );
  }

  private broadcastState() {
    this.onStateChange?.(this.getState());
  }

  private broadcastTransportState() {
    this.broadcastState();
  }

  private broadcastTransportPosition() {
    this.onTransportPosition?.(this.engine.position.getValue());
  }
}

// ----------------------------------------------------------------------------
// Utilities
// ----------------------------------------------------------------------------

function arrayBufferToBase64(buffer: ArrayBufferLike): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function generatePeaks(
  frames: ReadonlyArray<Float32Array>,
  width: number,
  channel: number,
): Float32Array {
  const ch = Math.min(channel, frames.length - 1);
  const data = frames[ch];
  const framesPerPixel = Math.max(1, Math.floor(data.length / width));
  const out = new Float32Array(width * 2);
  for (let i = 0; i < width; i++) {
    const start = i * framesPerPixel;
    const end = Math.min(start + framesPerPixel, data.length);
    let min = 0;
    let max = 0;
    for (let j = start; j < end; j++) {
      const v = data[j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[i * 2] = min;
    out[i * 2 + 1] = max;
  }
  return out;
}

export function createBootEnv(audioContext: AudioContext, audioWorklets: AudioWorklets): BootEnv {
  const sampleService = new SampleService(audioContext);
  const soundfontService = new SoundfontService();
  const sampleManager = new GlobalSampleLoaderManager(SampleStorage.get() as any);
  const soundfontManager = new GlobalSoundfontLoaderManager(SoundfontStorage.get() as any);
  return {
    audioContext,
    audioWorklets,
    sampleService,
    soundfontService,
    sampleManager,
    soundfontManager,
  };
}
