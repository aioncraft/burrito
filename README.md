# Burrito

Tooling for building and maintaining Firefox-based browsers.

Inspect a Firefox checkout against a pinned revision and report staged, unstaged, and untracked changes. Patch management and build orchestration are planned.

## Development

Install [Bun](https://bun.com), using the version specified in `package.json`, then clone the repository and install dependencies:

```sh
git clone https://github.com/aioncraft/burrito.git
cd burrito
bun install --frozen-lockfile
```

Show available commands:

```sh
bun run dev --help
```

Run type checking and regression tests:

```sh
bun run check
```

## Checkout status

Create `burrito.toml` in your browser project:

```toml
version = 1

[engine]
path = "engine"
revision = "<full Firefox commit hash>"
```

Replace the revision placeholder with the full commit hash you intend to build against. To inspect your existing checkout's revision, run `git -C engine rev-parse HEAD`. Engine paths are relative to the configuration file.

From the Burrito checkout:

```sh
bun run dev status --config /path/to/browser/burrito.toml
bun run dev status --config /path/to/browser/burrito.toml --json
```

The configuration defaults to `./burrito.toml` and must use UTF-8 encoding. The engine must be a Git checkout or linked worktree containing Firefox's `mach` and `moz.build` files. Its configured revision must be a full commit hash available locally.

Status reports the actual HEAD, whether it matches the configured baseline, and working-tree changes. In terminal output, the first change code describes the index and the second describes the working tree; `??` marks untracked files. Filenames are quoted so spaces and newlines remain unambiguous.

Inspection preserves the checkout and Git index. A baseline mismatch is reported with a successful exit code; invalid configuration or an inspection failure writes a diagnostic to stderr and returns a nonzero exit code. With `--json`, a successful inspection writes only the JSON report to stdout.

If HEAD changes during inspection, the command asks you to retry. The report is not an atomic snapshot of concurrent filesystem changes.
