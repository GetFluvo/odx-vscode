// Finds the `odx` to run: the configured one, the workspace's virtual
// environment, PATH, or a release downloaded from PyPI.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { unzipSync } from "fflate";
import * as vscode from "vscode";
import { pickWheel, PypiFile, scriptInWheel } from "./wheel";

const EXE = process.platform === "win32" ? "odx.exe" : "odx";

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(
      file,
      process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK,
    );
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function fromWorkspace(): string | undefined {
  const bin = process.platform === "win32" ? "Scripts" : "bin";
  for (const folder of vscode.workspace.workspaceFolders ?? []) {
    const candidate = path.join(folder.uri.fsPath, ".venv", bin, EXE);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function fromPath(): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = dir && path.join(dir, EXE);
    if (candidate && isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url}: HTTP ${response.status}`);
  }
  return response.json();
}

/** The newest release already downloaded, for when PyPI is out of reach. */
function newestDownloaded(storage: string): string | undefined {
  const dirs = fs.existsSync(storage)
    ? fs.readdirSync(storage).filter((name) => name.startsWith("odx-cli-"))
    : [];
  const newest = (a: string, b: string) =>
    b.localeCompare(a, undefined, { numeric: true });
  for (const dir of dirs.sort(newest)) {
    const candidate = path.join(storage, dir, EXE);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

async function download(
  storage: string,
  log: vscode.OutputChannel,
): Promise<string> {
  const index = await fetchJson("https://pypi.org/pypi/odx-cli/json");
  const version: string = index.info.version;
  // The version names a directory: nothing but a version may get there.
  if (!/^[0-9A-Za-z.+!-]+$/.test(version)) {
    throw new Error(`PyPI reports odx-cli version ${JSON.stringify(version)}`);
  }
  const target = path.join(storage, `odx-cli-${version}`, EXE);
  if (isExecutable(target)) {
    return target;
  }
  const wheel = pickWheel(
    index.urls as PypiFile[],
    process.platform,
    process.arch,
  );
  if (!wheel) {
    throw new Error(
      `odx-cli ${version} has no build for ${process.platform}-${process.arch}`,
    );
  }
  log.appendLine(`Downloading ${wheel.url}`);
  const data = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Window,
      title: `odx: downloading odx ${version}`,
    },
    async () => {
      const response = await fetch(wheel.url);
      if (!response.ok) {
        throw new Error(`${wheel.url}: HTTP ${response.status}`);
      }
      return new Uint8Array(await response.arrayBuffer());
    },
  );
  const digest = createHash("sha256").update(data).digest("hex");
  if (digest !== wheel.digests.sha256) {
    throw new Error(
      `${wheel.filename}: SHA-256 ${digest} does not match PyPI's ${wheel.digests.sha256}`,
    );
  }
  const member = scriptInWheel(version, process.platform);
  const files = unzipSync(data, { filter: (file) => file.name === member });
  if (!files[member]) {
    throw new Error(`${wheel.filename} has no ${member}`);
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, files[member], { mode: 0o755 });
  // Older downloads are not needed any more.
  for (const name of fs.readdirSync(storage)) {
    if (name.startsWith("odx-cli-") && name !== `odx-cli-${version}`) {
      fs.rmSync(path.join(storage, name), { recursive: true, force: true });
    }
  }
  return target;
}

export async function findOdx(
  context: vscode.ExtensionContext,
  log: vscode.OutputChannel,
): Promise<string> {
  const config = vscode.workspace.getConfiguration("odx");
  const configured = config.get<string>("path");
  if (configured) {
    return configured;
  }
  const local = fromWorkspace() ?? fromPath();
  if (local) {
    return local;
  }
  if (!config.get<boolean>("download")) {
    throw new Error(
      "odx not found; install it with `uv tool install odx-cli` or set odx.path",
    );
  }
  const storage = context.globalStorageUri.fsPath;
  try {
    return await download(storage, log);
  } catch (error) {
    const fallback = newestDownloaded(storage);
    if (fallback) {
      log.appendLine(`Could not check PyPI (${error}); using ${fallback}`);
      return fallback;
    }
    throw error;
  }
}
