import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { createEmptyProject, writeBundle } from "../../src/shared/bundle.js";

const EXTENSION_ID = "marius-patrik.vsdaw";

function getWorkspacePath(): string {
  return path.resolve(__dirname, "..", "..", "workspace");
}

function getFixturePath(): string {
  return path.resolve(__dirname, "..", "..", "fixtures", "sample.vsdaw");
}

async function ensureSampleFixture(): Promise<void> {
  const fixturePath = getFixturePath();
  if (fs.existsSync(fixturePath)) return;

  const project = createEmptyProject("Sample", 48000);
  const bytes = await writeBundle(project);
  fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
  fs.writeFileSync(fixturePath, bytes);
}

suite("VSDAW Extension Integration", () => {
  test("activates the extension", async () => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(ext, `Extension ${EXTENSION_ID} is not installed`);
    await ext.activate();
    assert.strictEqual(ext.isActive, true);
  });

  test("creates a new project", async () => {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(workspaceFolder, "No workspace folder open");
    const workspacePath = workspaceFolder.uri.fsPath;
    fs.mkdirSync(workspacePath, { recursive: true });

    // Remove any existing untitled projects.
    for (const name of ["Untitled.vsdaw", "Untitled-1.vsdaw"]) {
      const candidate = path.join(workspacePath, name);
      if (fs.existsSync(candidate)) {
        fs.unlinkSync(candidate);
      }
    }

    await vscode.commands.executeCommand("vsdaw.newProject");
    await new Promise((resolve) => setTimeout(resolve, 1500));

    const created =
      fs.existsSync(path.join(workspacePath, "Untitled.vsdaw")) ||
      fs.existsSync(path.join(workspacePath, "Untitled-1.vsdaw"));
    assert.ok(created, "Expected a new .vsdaw file in the workspace");
  });

  test("opens a .vsdaw file and loads the engine webview", async () => {
    await ensureSampleFixture();
    const uri = vscode.Uri.file(getFixturePath());
    await vscode.commands.executeCommand("vscode.openWith", uri, "vsdaw.editor");
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
    assert.ok(tabs.length > 0, "No tabs were opened");
    assert.ok(
      tabs.some((tab) => tab.label.includes("VSDAW") || tab.label.includes("Sample")),
      "Expected a VSDAW tab to be open",
    );
  });
});
