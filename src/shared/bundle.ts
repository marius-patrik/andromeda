import JSZip from "jszip";
import type { ProjectJson } from "./schemas.js";

export interface BundleReadResult {
  project: ProjectJson;
  audioFiles: Map<string, Uint8Array>;
}

export class BundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BundleError";
  }
}

export function createEmptyProject(name = "Untitled", sampleRate = 48000): ProjectJson {
  const now = new Date().toISOString();
  return {
    $schema: "vsdaw://project.json/v1",
    version: "1.0.0",
    createdBy: "vsdaw",
    createdAt: now,
    project: {
      name,
      sampleRate,
      tempo: 120,
      timeSignature: [4, 4],
      loop: { enabled: false, start: 0, end: 0 },
    },
    tracks: [
      {
        id: "track-1",
        name: "Audio 1",
        type: "audio",
        color: "#3b82f6",
        volumeDb: 0,
        pan: 0,
        mute: false,
        solo: false,
        arm: false,
        inserts: [],
      },
    ],
    regions: [],
    midiClips: [],
    automation: [],
    mixer: { masterVolumeDb: 0 },
  };
}

export async function readBundle(data: Uint8Array): Promise<BundleReadResult> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch {
    throw new BundleError("Failed to parse ZIP archive");
  }

  const projectFile = zip.file("project.json");
  if (!projectFile) {
    throw new BundleError("Missing project.json in bundle");
  }

  const projectText = await projectFile.async("string");
  let project: unknown;
  try {
    project = JSON.parse(projectText);
  } catch {
    throw new BundleError("project.json is not valid JSON");
  }

  const audioFiles = new Map<string, Uint8Array>();
  for (const [relativePath, zipEntry] of Object.entries(zip.files)) {
    if (relativePath.startsWith("audio/") && !zipEntry.dir) {
      const buffer = await zipEntry.async("uint8array");
      audioFiles.set(relativePath, buffer);
    }
  }

  return { project: project as ProjectJson, audioFiles };
}

export async function writeBundle(
  project: ProjectJson,
  audioFiles: Map<string, Uint8Array> = new Map(),
): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file("project.json", JSON.stringify(project, null, 2));

  if (audioFiles.size > 0) {
    const audioFolder = zip.folder("audio");
    if (!audioFolder) {
      throw new BundleError("Failed to create audio folder in bundle");
    }
    for (const [relativePath, data] of audioFiles) {
      const name = relativePath.replace(/^audio\//, "");
      audioFolder.file(name, data);
    }
  }

  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
