// What `odx dashboard --json` and `odx status --json` print, and what the
// extension makes of it. No VS Code API here, so it can be tested on its own.

export type Action =
  | "include"
  | "port"
  | "mute"
  | "drop"
  | "follow"
  | "promote";

export interface Entry {
  id: string;
  addon?: string | null;
  subject: string;
  state: string;
  actions: Action[];
  notes: string[];
}

export interface Section {
  kind: string;
  fetched_at: number;
  entries: Entry[];
}

export interface Dashboard {
  schema: number;
  series: string;
  generated_at: number;
  sections: Section[];
}

export interface PullRequest {
  name: string;
  url: string;
  pr: number;
  state?: string | null;
  title?: string | null;
  merged_at?: string | null;
  labels: string[];
  head?: string | null;
  new_commits?: number | null;
  advice: string;
  error?: string | null;
}

export interface Status {
  schema: number;
  pull_requests: PullRequest[];
  modified: { name: string; dir: string; changes: number }[];
}

/** The headings of the sections, as odx names them. */
const TITLES: Record<string, string> = {
  pinned: "Pinned pull requests",
  droppable: "Overrides that can be dropped",
  "new-upstream": "New upstream pull requests",
  "forward-port": "Forward-port suggestions",
  backport: "Backport candidates",
  "auto-update": "Index updates",
  glue: "Glue addons the project misses",
  drift: "Environment drift",
  suppressed: "Suppressed",
};

export function sectionTitle(kind: string): string {
  return TITLES[kind] ?? kind;
}

function schemaOne<T extends { schema: number }>(value: T, what: string): T {
  if (value.schema !== 1) {
    throw new Error(
      `${what} has schema ${value.schema}; this extension reads schema 1: update it`,
    );
  }
  return value;
}

/** The dashboards of `odx --json dashboard`, one per series. */
export function parseDashboards(text: string): Dashboard[] {
  const value = JSON.parse(text) as Dashboard[];
  return value.map((dashboard) => schemaOne(dashboard, "odx dashboard"));
}

/** What `odx --json status` prints. */
export function parseStatus(text: string): Status {
  return schemaOne(JSON.parse(text) as Status, "odx status");
}

/** The arguments of `odx dashboard act` for `action` on the entry `id`. */
export function actArgs(
  id: string,
  action: Action,
  options: { reason?: string; openPr?: boolean } = {},
): string[] {
  const args = ["dashboard", "act", id, `--${action}`];
  if (options.reason !== undefined) {
    // One argument, so a reason that starts with `-` is not read as a flag.
    args.push(`--reason=${options.reason}`);
  }
  if (options.openPr) {
    args.push("--open-pr");
  }
  return args;
}

/** Actions that write a branch first and open its pull request on request.
 * A port is asked about before it runs: running it again with `--open-pr`
 * would port the change a second time. */
export function opensPullRequest(action: Action): boolean {
  return action === "promote";
}

/** The context value of an entry, which the menus match its actions in. */
export function contextValue(entry: Entry): string {
  return ["entry", ...entry.actions].join(" ");
}

/** The entries a person may act on: those with actions, suppressed ones aside. */
export function actionable(dashboards: Dashboard[]): number {
  return dashboards
    .flatMap((dashboard) => dashboard.sections)
    .filter((section) => section.kind !== "suppressed")
    .flatMap((section) => section.entries)
    .filter((entry) => entry.actions.length > 0).length;
}

/** The status bar text for the dashboards. */
export function summary(dashboards: Dashboard[]): string {
  const count = actionable(dashboards);
  if (count === 0) {
    return "odx: nothing to act on";
  }
  return `odx: ${count} to act on`;
}

/** The pull request's page, when it is on a forge odx knows the layout of. */
export function pullRequestUrl(row: PullRequest): string | undefined {
  const base = row.url.replace(/\.git$/, "").replace(/\/$/, "");
  let host: string;
  try {
    const url = new URL(base);
    if (url.protocol !== "https:") {
      return undefined;
    }
    host = url.hostname;
  } catch {
    return undefined;
  }
  if (host === "github.com") {
    return `${base}/pull/${row.pr}`;
  }
  if (host === "gitlab.com" || host.startsWith("gitlab.")) {
    return `${base}/-/merge_requests/${row.pr}`;
  }
  return `${base}/pulls/${row.pr}`;
}

/** The description of a pull request row. */
export function describe(row: PullRequest): string {
  const parts = [row.state ?? "unknown"];
  if (row.new_commits) {
    parts.push(`+${row.new_commits} commits`);
  }
  if (row.error) {
    parts.push(row.error);
  }
  return parts.join(", ");
}

/** Whether a `pyproject.toml` configures odx: it has a `[tool.odx]` table
 * or one of its subtables. */
export function declaresOdx(pyproject: string): boolean {
  return /^\s*\[\s*tool\.odx\s*[\].]/m.test(pyproject);
}
