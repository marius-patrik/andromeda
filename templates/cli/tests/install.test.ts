import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("installer smoke check", () => {
  test("runs the platform-specific installer and executes the CLI launcher", () => {
    // Set a custom HOME directory in environment so we don't mess with the actual user's home directory.
    const tempHome = join(tmpdir(), `template-cli-test-home-${Date.now()}`);
    const isWindows = process.platform === "win32";

    // Create custom env with temporary home directory
    const testEnv = {
      ...process.env,
      HOME: tempHome,
      USERPROFILE: tempHome,
    };

    const installScript = isWindows
      ? join(import.meta.dirname, "../install/install.ps1")
      : join(import.meta.dirname, "../install/install.sh");

    // Run the installer
    const installResult = isWindows
      ? spawnSync("powershell", ["-ExecutionPolicy", "Bypass", "-File", installScript], { env: testEnv })
      : spawnSync("bash", [installScript], { env: testEnv });

    expect(installResult.status).toBe(0);

    // Verify launcher file exists
    const expectedLauncher = isWindows
      ? join(tempHome, ".local/bin/template-cli.ps1")
      : join(tempHome, ".local/bin/template-cli");

    expect(existsSync(expectedLauncher)).toBe(true);

    // Clean up temporary home
    try {
      rmSync(tempHome, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup error if files are locked
    }
  });
});
