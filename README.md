# odx for VS Code

[odx](https://odx.readthedocs.io/) in the editor: the dashboard of an Odoo
project's pinned pull requests, upstream changes, ports, glue addons and
environment drift, with the actions odx can take on them, and the main odx
commands.

## Features

- **Dashboard view.** The sections of `odx dashboard`, each entry with its
  state and notes. Right-click an entry for what odx can do about it:
  include a pull request, port a change, drop an override, follow an index
  update, promote an addon into the next environment, or mute it with a
  reason. Port asks whether to open a draft pull request as well; promote
  writes the plan first and offers to open its pull request.
- **Pull requests view.** What `odx status` tracks: each aggregated or pinned
  pull request, its state upstream and its new commits; a click opens it on
  the forge.
- **Status bar.** How many entries there are to act on; a click opens the
  dashboard.
- **Commands** (`odx:` in the Command Palette) for `odx aggregate`, `lock`,
  `vendor`, `dev`, `sniff`, `check-deps`, `verify`, `glue` and `changelog`.
  They run as tasks in the terminal and the views refresh when one ends;
  after a lock, the changelog of `odx.lock` opens in a Markdown preview.
- **Import.** A folder with a git-aggregator `repos.yaml` and no odx project
  yet offers to import it (`odx import repos.yaml --write`).

Lint diagnostics for Odoo modules come from the
[odoo-lint](https://marketplace.visualstudio.com/items?itemName=bosd.odoo-lint)
extension; this one does not duplicate them.

## The odx executable

The extension runs `odx` from the `odx.path` setting, else from the
workspace's `.venv`, else from `PATH`. Without one, it downloads the latest
`odx-cli` release from PyPI into its own storage (checked against PyPI's
SHA-256), unless `odx.download` is off. It asks before the first download;
"Never" turns `odx.download` off. Install it yourself with
`uv tool install odx-cli`.

## Settings

| Setting        | Default |                                                           |
| -------------- | ------- | --------------------------------------------------------- |
| `odx.path`     |         | The `odx` executable to run                               |
| `odx.download` | `true`  | Download `odx` from PyPI when it is not installed         |
| `odx.offline`  | `false` | Build the dashboard from cached forge and index data only |

The views fill in a workspace whose `pyproject.toml`, there or in a
directory above, has a `[tool.odx]` table; in a multi-root workspace, the
first folder that is in an odx project. The extension needs a trusted
workspace: it runs the odx executable, which the workspace can select.

## Development

```console
$ npm ci
$ npm run typecheck && npm run build && npm test
$ npm run test:vscode   # in VS Code, against a stand-in odx
$ npm run package       # odx-<version>.vsix
```

## License

MIT
