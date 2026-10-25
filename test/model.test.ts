import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { test } from "node:test";
import {
  actArgs,
  actionable,
  contextValue,
  declaresOdx,
  describe,
  opensPullRequest,
  parseDashboards,
  parseStatus,
  pullRequestUrl,
  sectionTitle,
  summary,
} from "../src/model";

const fixture = (name: string) =>
  fs.readFileSync(path.join(__dirname, "..", "test", "fixture", name), "utf8");

test("reads the dashboards and counts what can be acted on", () => {
  const dashboards = parseDashboards(fixture("dashboards.json"));
  assert.equal(dashboards[0].series, "19.0");
  // The suppressed entry and the one without actions do not count.
  assert.equal(actionable(dashboards), 2);
  assert.equal(summary(dashboards), "odx: 2 to act on");
  assert.equal(summary([]), "odx: nothing to act on");
});

test("refuses another schema", () => {
  assert.throws(
    () => parseDashboards('[{"schema": 2, "sections": []}]'),
    /schema 2; this extension reads schema 1/,
  );
  assert.throws(() => parseStatus('{"schema": 3}'), /odx status has schema 3/);
});

test("names the sections as odx does", () => {
  assert.equal(sectionTitle("glue"), "Glue addons the project misses");
  assert.equal(sectionTitle("later"), "later");
});

test("builds the arguments of odx dashboard act", () => {
  assert.deepEqual(actArgs("pr:OCA/pos#1", "drop"), [
    "dashboard",
    "act",
    "pr:OCA/pos#1",
    "--drop",
  ]);
  assert.deepEqual(actArgs("glue:x", "mute", { reason: "not used" }), [
    "dashboard",
    "act",
    "glue:x",
    "--mute",
    "--reason=not used",
  ]);
  assert.equal(
    actArgs("glue:x", "mute", { reason: "--later" })[4],
    "--reason=--later",
  );
  assert.deepEqual(actArgs("drift:a", "promote", { openPr: true }).slice(3), [
    "--promote",
    "--open-pr",
  ]);
  assert.ok(opensPullRequest("promote"));
  assert.ok(!opensPullRequest("port") && !opensPullRequest("include"));
});

test("puts the actions in the context value", () => {
  const [entry] = parseDashboards(fixture("dashboards.json"))[0].sections[1]
    .entries;
  assert.equal(contextValue(entry), "entry drop mute");
});

test("links pull requests per forge", () => {
  const row = parseStatus(fixture("status.json")).pull_requests[0];
  assert.equal(pullRequestUrl(row), "https://github.com/OCA/pos/pull/789");
  assert.equal(
    pullRequestUrl({ ...row, url: "https://gitlab.com/a/b.git" }),
    "https://gitlab.com/a/b/-/merge_requests/789",
  );
  assert.equal(
    pullRequestUrl({ ...row, url: "https://codeberg.org/a/b/" }),
    "https://codeberg.org/a/b/pulls/789",
  );
  assert.equal(
    pullRequestUrl({ ...row, url: "https://github.com/a/gitlab-sync.git" }),
    "https://github.com/a/gitlab-sync/pull/789",
  );
  assert.equal(
    pullRequestUrl({ ...row, url: "https://gitlab.example.org/a/b" }),
    "https://gitlab.example.org/a/b/-/merge_requests/789",
  );
  assert.equal(
    pullRequestUrl({ ...row, url: "git@github.com:a/b.git" }),
    undefined,
  );
  assert.equal(
    pullRequestUrl({ ...row, url: "http://github.com/a/b" }),
    undefined,
  );
  assert.equal(describe(row), "open, +2 commits");
  assert.equal(
    describe({ ...row, state: null, new_commits: 0, error: "HTTP 404" }),
    "unknown, HTTP 404",
  );
});

test("tells an odx project by its pyproject.toml", () => {
  assert.ok(
    declaresOdx('[project]\nname = "p"\n\n[tool.odx]\nodoo_version = "19.0"\n'),
  );
  assert.ok(declaresOdx("[tool.odx.groups]\nx = []\n"));
  assert.ok(!declaresOdx("[tool.odxx]\n[tool.ruff]\n"));
  assert.ok(!declaresOdx('name = "[tool.odx]"\n'));
});
