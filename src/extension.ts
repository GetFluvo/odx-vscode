// odx for VS Code: the dashboard of `odx dashboard --json` and the pull
// requests of `odx status --json` as tree views, their actions through
// `odx dashboard act`, and the main odx commands as tasks. Lint diagnostics
// come from odoo-lint's own extension.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";
import { Confirm, findOdx } from "./binary";
import {
  Action,
  actArgs,
  contextValue,
  Dashboard,
  declaresOdx,
  describe,
  Entry,
  opensPullRequest,
  parseDashboards,
  parseStatus,
  PullRequest,
  pullRequestUrl,
  Section,
  sectionTitle,
  summary,
} from "./model";

let log: vscode.LogOutputChannel;

/** What the commands and the tests reach. */
export interface Api {
  refresh(): Promise<void>;
  dashboards(): Dashboard[];
  pullRequests(): PullRequest[];
  statusText(): string;
}

type Node =
  | { kind: "series"; dashboard: Dashboard }
  | { kind: "section"; section: Section }
  | { kind: "entry"; entry: Entry }
  | { kind: "note"; text: string }
  | { kind: "pr"; row: PullRequest };

interface Ran {
  code: number;
  stdout: string;
  stderr: string;
}

/** Whether `folder` is in an odx project: a `pyproject.toml` with
 * `[tool.odx]` there or in a directory above, as odx looks for it. */
function inProject(folder: string): boolean {
  let dir: string | undefined = folder;
  while (dir) {
    try {
      const pyproject = fs.readFileSync(
        path.join(dir, "pyproject.toml"),
        "utf8",
      );
      if (declaresOdx(pyproject)) {
        return true;
      }
    } catch {
      // No pyproject.toml here; look further up.
    }
    const parent = path.dirname(dir);
    dir = parent === dir ? undefined : parent;
  }
  return false;
}

/** Ask once a session before the first download of odx; "Never" turns
 * downloading off. */
let declined = false;
const confirmDownload: Confirm = async () => {
  if (declined) {
    return false;
  }
  const answer = await vscode.window.showInformationMessage(
    "odx is not installed. Download the latest odx-cli from PyPI?",
    "Download",
    "Not Now",
    "Never",
  );
  if (answer === "Never") {
    await vscode.workspace
      .getConfiguration("odx")
      .update("download", false, vscode.ConfigurationTarget.Global);
  }
  declined = answer !== "Download";
  return !declined;
};

class Odx {
  private program: Promise<string> | undefined;
  private previous: Promise<unknown> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {}

  /** The folder odx runs in: the first workspace folder in an odx project,
   * else the first one with a `repos.yaml` to import, else the first one. */
  root(): string | undefined {
    const folders = (vscode.workspace.workspaceFolders ?? []).map(
      (folder) => folder.uri.fsPath,
    );
    return (
      folders.find(inProject) ??
      folders.find((folder) =>
        fs.existsSync(path.join(folder, "repos.yaml")),
      ) ??
      folders[0]
    );
  }

  isProject(): boolean {
    const root = this.root();
    return root !== undefined && inProject(root);
  }

  path(): Promise<string> {
    // After the previous lookup, so two downloads never write at once.
    this.program ??= this.previous
      .then(() => findOdx(this.context, log, confirmDownload))
      .catch((error) => {
        this.program = undefined;
        throw error;
      });
    this.previous = this.program.catch(() => undefined);
    return this.program;
  }

  forget(): void {
    this.program = undefined;
  }

  async run(args: string[]): Promise<Ran> {
    const program = await this.path();
    log.info(`odx ${args.join(" ")}`);
    return new Promise((resolve) => {
      execFile(
        program,
        args,
        { cwd: this.root(), maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) => {
          const code =
            error && typeof error.code === "number"
              ? error.code
              : error
                ? 1
                : 0;
          // odx did not start (ENOENT, EACCES): say why.
          if (error && typeof error.code !== "number") {
            stderr = `${stderr}${error.message}\n`;
          }
          if (stderr) {
            log.info(stderr.trimEnd());
          }
          resolve({ code, stdout, stderr });
        },
      );
    });
  }
}

function failure(ran: Ran): string {
  return (
    ran.stderr.trim().split("\n").pop() || `odx exited with code ${ran.code}`
  );
}

class DashboardTree implements vscode.TreeDataProvider<Node> {
  dashboards: Dashboard[] = [];
  /** Shown instead of the dashboard: loading, or why it failed. */
  private notice: string | undefined = "Loading…";
  private welcome = false;
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  set(dashboards: Dashboard[]): void {
    this.dashboards = dashboards;
    this.notice = undefined;
    this.welcome = false;
    this.changed.fire();
  }

  /** Not an odx project: no rows, so the welcome view shows. */
  clear(): void {
    this.dashboards = [];
    this.notice = undefined;
    this.welcome = true;
    this.changed.fire();
  }

  fail(message: string): void {
    // A dashboard shown before stays; only a first failure replaces it.
    if (this.notice !== undefined) {
      this.notice = `Failed: ${message}`;
      this.changed.fire();
    }
  }

  getChildren(node?: Node): Node[] {
    if (!node && this.welcome) {
      return [];
    }
    if (!node && this.notice !== undefined) {
      return [{ kind: "note", text: this.notice }];
    }
    const empty = this.dashboards.every((dashboard) =>
      dashboard.sections.every((section) => section.entries.length === 0),
    );
    if (!node && empty) {
      return [{ kind: "note", text: "Nothing to report" }];
    }
    const sections = (dashboard: Dashboard): Node[] =>
      dashboard.sections
        .filter((section) => section.entries.length > 0)
        .map((section) => ({ kind: "section", section }));
    if (!node) {
      return this.dashboards.length === 1
        ? sections(this.dashboards[0])
        : this.dashboards.map((dashboard) => ({ kind: "series", dashboard }));
    }
    switch (node.kind) {
      case "series":
        return sections(node.dashboard);
      case "section":
        return node.section.entries.map((entry) => ({ kind: "entry", entry }));
      case "entry":
        return node.entry.notes.map((text) => ({ kind: "note", text }));
      default:
        return [];
    }
  }

  getTreeItem(node: Node): vscode.TreeItem {
    const { Collapsed, Expanded, None } = vscode.TreeItemCollapsibleState;
    switch (node.kind) {
      case "series": {
        const item = new vscode.TreeItem(node.dashboard.series, Expanded);
        item.iconPath = new vscode.ThemeIcon("versions");
        return item;
      }
      case "section": {
        const item = new vscode.TreeItem(
          sectionTitle(node.section.kind),
          node.section.kind === "suppressed" ? Collapsed : Expanded,
        );
        item.description = String(node.section.entries.length);
        return item;
      }
      case "entry": {
        const { entry } = node;
        const item = new vscode.TreeItem(
          entry.subject,
          entry.notes.length ? Collapsed : None,
        );
        item.id = entry.id;
        item.description = entry.state;
        item.tooltip = new vscode.MarkdownString(
          [`\`${entry.id}\``, ...entry.notes].join("\n\n"),
        );
        item.contextValue = contextValue(entry);
        return item;
      }
      case "note":
        return new vscode.TreeItem(node.text, None);
      case "pr":
        return new vscode.TreeItem(node.row.name, None);
    }
  }
}

class PullRequestTree implements vscode.TreeDataProvider<Node> {
  rows: PullRequest[] = [];
  private readonly changed = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changed.event;

  set(rows: PullRequest[]): void {
    this.rows = rows;
    this.changed.fire();
  }

  getChildren(node?: Node): Node[] {
    return node ? [] : this.rows.map((row) => ({ kind: "pr", row }));
  }

  getTreeItem(node: Node): vscode.TreeItem {
    if (node.kind !== "pr") {
      return new vscode.TreeItem("");
    }
    const { row } = node;
    const item = new vscode.TreeItem(
      `${row.name}#${row.pr}${row.title ? ` ${row.title}` : ""}`,
    );
    item.description = describe(row);
    item.tooltip = row.advice || undefined;
    item.contextValue = "pr";
    if (pullRequestUrl(row)) {
      item.command = {
        command: "odx.open",
        title: "Open on the Forge",
        arguments: [node],
      };
    }
    item.iconPath = new vscode.ThemeIcon(
      row.state === "merged"
        ? "git-merge"
        : row.state === "closed"
          ? "git-pull-request-closed"
          : "git-pull-request",
    );
    return item;
  }
}

/** The odx commands that run as tasks in a terminal, by command id. */
const TASKS: Record<string, { args: string[]; title: string }> = {
  "odx.aggregate": { args: ["aggregate"], title: "aggregate" },
  "odx.lock": { args: ["lock"], title: "lock" },
  "odx.vendor": { args: ["vendor"], title: "vendor" },
  "odx.dev": { args: ["dev"], title: "dev" },
  "odx.sniff": { args: ["sniff", "--since", "HEAD"], title: "sniff" },
  "odx.checkDeps": { args: ["check-deps"], title: "check-deps" },
  "odx.verify": { args: ["verify"], title: "verify" },
  "odx.glue": { args: ["glue"], title: "glue" },
  "odx.import": { args: ["import", "repos.yaml", "--write"], title: "import" },
};

export function activate(context: vscode.ExtensionContext): Api {
  log = vscode.window.createOutputChannel("odx", { log: true });
  const odx = new Odx(context);
  const dashboard = new DashboardTree();
  const pullRequests = new PullRequestTree();
  const status = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
  );
  status.command = "odx.dashboard.focus";
  status.text = "odx";

  // Only the latest refresh shows its result; an older one may end last.
  let generation = 0;
  const refresh = async (): Promise<void> => {
    const project = odx.isProject();
    void vscode.commands.executeCommand("setContext", "odx.project", project);
    const root = odx.root();
    void vscode.commands.executeCommand(
      "setContext",
      "odx.reposYaml",
      root !== undefined && fs.existsSync(path.join(root, "repos.yaml")),
    );
    if (!project) {
      status.hide();
      dashboard.clear();
      pullRequests.set([]);
      return;
    }
    const current = ++generation;
    const offline = vscode.workspace
      .getConfiguration("odx")
      .get<boolean>("offline")
      ? ["--offline"]
      : [];
    await vscode.window.withProgress(
      { location: { viewId: "odx.dashboard" } },
      async () => {
        try {
          const [board, rows] = await Promise.all([
            odx.run(["--json", ...offline, "dashboard"]),
            odx.run(["--json", ...offline, "status"]),
          ]);
          if (current !== generation) {
            return;
          }
          if (rows.code !== 0) {
            log.warn(`odx status: ${failure(rows)}`);
          }
          if (board.code !== 0) {
            throw new Error(`odx dashboard: ${failure(board)}`);
          }
          dashboard.set(parseDashboards(board.stdout));
          pullRequests.set(
            rows.code === 0 ? parseStatus(rows.stdout).pull_requests : [],
          );
          status.text = `$(git-pull-request) ${summary(dashboard.dashboards)}`;
          status.show();
        } catch (error) {
          if (current !== generation) {
            return;
          }
          const message =
            error instanceof Error ? error.message : String(error);
          log.error(message);
          dashboard.fail(message);
          void vscode.window.showErrorMessage(`odx: ${message}`);
        }
      },
    );
  };

  const act = (action: Action) => async (node?: Node) => {
    if (node?.kind !== "entry") {
      return;
    }
    let reason: string | undefined;
    if (action === "mute") {
      reason = await vscode.window.showInputBox({
        prompt: `Why mute ${node.entry.id}?`,
        validateInput: (text) =>
          text.trim() ? undefined : "A reason is required",
      });
      if (reason === undefined) {
        return;
      }
    }
    let openPr = false;
    if (action === "port") {
      const pick = await vscode.window.showQuickPick(
        [
          { label: "Port", openPr: false },
          { label: "Port and open a draft pull request", openPr: true },
        ],
        { placeHolder: `Port ${node.entry.id}` },
      );
      if (!pick) {
        return;
      }
      openPr = pick.openPr;
    }
    const ran = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `odx: ${action} ${node.entry.id}`,
      },
      () => odx.run(actArgs(node.entry.id, action, { reason, openPr })),
    );
    if (ran.code !== 0) {
      void vscode.window.showErrorMessage(`odx: ${failure(ran)}`);
      return;
    }
    log.info(ran.stdout.trimEnd());
    if (action === "port") {
      void vscode.window.showInformationMessage(
        ran.stdout.trim().split("\n").pop() || "odx: ported",
      );
    }
    if (opensPullRequest(action)) {
      const open = await vscode.window.showInformationMessage(
        ran.stdout.trim().split("\n")[0] || `odx: ${action} done`,
        "Open Pull Request",
        "Show Output",
      );
      if (open === "Show Output") {
        log.show();
      } else if (open === "Open Pull Request") {
        const opened = await odx.run(
          actArgs(node.entry.id, action, { openPr: true }),
        );
        if (opened.code !== 0) {
          void vscode.window.showErrorMessage(`odx: ${failure(opened)}`);
        } else {
          void vscode.window.showInformationMessage(
            opened.stdout.trim().split("\n").pop() ||
              "odx: pull request opened",
          );
        }
      }
    }
    await refresh();
  };

  const task = (id: string) => async () => {
    const { args, title } = TASKS[id];
    const program = await odx.path().catch((error) => {
      void vscode.window.showErrorMessage(`odx: ${error.message ?? error}`);
      return undefined;
    });
    const root = odx.root();
    const folder = vscode.workspace.workspaceFolders?.find(
      (candidate) => candidate.uri.fsPath === root,
    );
    if (!program || !folder) {
      return;
    }
    const execution = await vscode.tasks.executeTask(
      new vscode.Task(
        { type: "odx", command: title },
        folder,
        title,
        "odx",
        new vscode.ProcessExecution(program, args, { cwd: folder.uri.fsPath }),
      ),
    );
    if (id !== "odx.lock") {
      return;
    }
    const done = vscode.tasks.onDidEndTaskProcess(async (event) => {
      if (event.execution !== execution) {
        return;
      }
      done.dispose();
      if (event.exitCode === 0) {
        const show = await vscode.window.showInformationMessage(
          "odx: odx.lock written",
          "Show Changelog",
        );
        if (show) {
          await vscode.commands.executeCommand("odx.changelog");
        }
      }
    });
    context.subscriptions.push(done);
  };

  const changelog = async () => {
    const ran = await odx.run(["changelog"]);
    if (ran.code !== 0) {
      void vscode.window.showErrorMessage(`odx: ${failure(ran)}`);
      return;
    }
    const document = await vscode.workspace.openTextDocument({
      language: "markdown",
      content: ran.stdout,
    });
    await vscode.commands.executeCommand("markdown.showPreview", document.uri);
  };

  context.subscriptions.push(
    log,
    status,
    // What a task changed shows in the views once it is done.
    vscode.tasks.onDidEndTaskProcess((event) => {
      if (event.execution.task.definition.type === "odx") {
        void refresh();
      }
    }),
    vscode.window.registerTreeDataProvider("odx.dashboard", dashboard),
    vscode.window.registerTreeDataProvider("odx.pullRequests", pullRequests),
    vscode.commands.registerCommand("odx.refresh", refresh),
    vscode.commands.registerCommand("odx.showLogs", () => log.show()),
    vscode.commands.registerCommand("odx.changelog", changelog),
    vscode.commands.registerCommand("odx.open", (node?: Node) => {
      const url = node?.kind === "pr" ? pullRequestUrl(node.row) : undefined;
      if (url) {
        void vscode.env.openExternal(vscode.Uri.parse(url));
      }
    }),
    ...(
      ["include", "port", "mute", "drop", "follow", "promote"] as Action[]
    ).map((action) =>
      vscode.commands.registerCommand(`odx.${action}`, act(action)),
    ),
    ...Object.keys(TASKS).map((id) =>
      vscode.commands.registerCommand(id, task(id)),
    ),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("odx")) {
        odx.forget();
        void refresh();
      }
    }),
  );
  void refresh();
  return {
    refresh,
    dashboards: () => dashboard.dashboards,
    pullRequests: () => pullRequests.rows,
    statusText: () => status.text,
  };
}

export function deactivate(): void {}
