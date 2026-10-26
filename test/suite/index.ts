// Runs inside VS Code: the views fill from the stand-in odx, and an entry's
// action runs `odx dashboard act`.

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as vscode from "vscode";
import type { Api } from "../../src/extension";

export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<Api>("getfluvo.odx");
  assert.ok(extension, "the extension is installed");
  const api = await extension.activate();
  await api.refresh();

  const [dashboard] = api.dashboards();
  assert.equal(dashboard.series, "19.0");
  assert.equal(api.pullRequests()[0].pr, 789);
  assert.match(api.statusText(), /odx: 2 to act on/);

  const drop = dashboard.sections[1].entries[0];
  await vscode.commands.executeCommand("odx.drop", {
    kind: "entry",
    entry: drop,
  });
  const acts = fs
    .readFileSync(process.env.ODX_FAKE_LOG!, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(acts, [["dashboard", "act", drop.id, "--drop"]]);
  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("odx.import"), "odx.import is registered");
  console.log(`odx: ${api.statusText()}; ${drop.id} dropped`);
}
