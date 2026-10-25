# Changelog

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
