// Starts VS Code with the extension and test/fixture/project as the
// workspace, and runs test/suite in it against test/fixture/bin/odx.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runTests } from "@vscode/test-electron";

async function main(): Promise<void> {
  const root = path.resolve(__dirname, "..");
  const fixture = path.join(root, "test", "fixture");
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "odx-vscode-"));
  fs.mkdirSync(path.join(scratch, "User"));
  fs.writeFileSync(
    path.join(scratch, "User", "settings.json"),
    JSON.stringify({
      "odx.path": path.join(fixture, "bin", "odx"),
      "odx.download": false,
    }),
  );
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.join(__dirname, "suite", "index.js"),
      extensionTestsEnv: { ODX_FAKE_LOG: path.join(scratch, "acts.log") },
      launchArgs: [
        path.join(fixture, "project"),
        "--disable-extensions",
        `--user-data-dir=${scratch}`,
      ],
    });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
