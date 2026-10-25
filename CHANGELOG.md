# Changelog

## 0.1.1

- Port asks first whether to open a draft pull request too; running the
  port a second time to open one failed on the branch it had written.
- Only `pyproject.toml` with `[tool.odx]` makes a project, also in a
  directory above the workspace; a bare `repos.yaml` is git-aggregator's,
  which odx does not read.
- The dashboard says it is loading, or why it failed, instead of "No odx
  project here"; an older refresh no longer overwrites a newer one.
- An odx that cannot start says why (`spawn … ENOENT`).
- A mute reason starting with `-` is passed as the reason.
- Pull request links go by the forge's host name.
- Not in untrusted or virtual workspaces; downloads check the HTTP status and
  the version they are given, and never run at the same time.

## 0.1.0

- The odx view: the dashboard of `odx dashboard --json`, per section, with
  each entry's actions (include, port, drop, follow, promote, mute) in its
  context menu, run through `odx dashboard act`; port and promote offer to
  open the pull request afterwards.
- The pull requests of `odx status --json`, linked to their forge.
- A status bar item with the number of entries to act on.
- Commands for `odx aggregate`, `lock`, `vendor`, `dev`, `sniff`,
  `check-deps`, `verify` and `glue`, run as tasks; after `odx lock`, the
  changelog of `odx.lock` in a Markdown preview.
- `odx` from `odx.path`, the workspace's `.venv`, `PATH`, or downloaded from
  PyPI (checked against its SHA-256).
