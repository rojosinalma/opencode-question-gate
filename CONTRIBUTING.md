# Contributing

## Running it locally

The plugin is a single Bun/TypeScript file with no runtime dependencies. To run it against an
OpenCode 2.x server, clone (or symlink) the checkout into the plugins directory and restart the
server:

```sh
git clone https://github.com/rojosinalma/opencode-question-gate ~/.config/opencode/plugins/question-gate
```

Enable `debug: true` through a `plugins[]` entry in `opencode.jsonc` (see `docs/configuration.md`)
to see every decision on the server's stderr, then trigger a `question` call from a thinking model
and watch the `[question-gate]` lines.

## Tests

The pure helpers are covered by `test/question-gate.test.ts` and run without an OpenCode server:

```sh
bun install
bun test
```

`bun install` only fetches `@opencode/plugin` for its types. The same suite runs in CI
(`.github/workflows/run-tests.yml`) on every push and pull request. Add a test for every change in
how text is counted, how the turn key is derived or how the premise is recovered.

## Code style and layout

- `index.ts` — the whole plugin: option resolution, pure helpers (exported for the tests) and the
  `setup()` that registers the two hooks.
- `test/question-gate.test.ts` — the `bun:test` suite.
- `docs/` — configuration, design and troubleshooting.
- No semicolons, double quotes, 2-space indent, `camelCase` for resolved options and `snake_case`
  for the keys read from `opencode.jsonc`.
- Keep `@opencode/plugin` an `import type`: the plugin directory may have no `node_modules` of its
  own at runtime.
- Anything inside the `execute.before` hook that is not the deliberate nudge must fail open: catch,
  log, let the call through.

## Commits and PRs

Plain, descriptive commit messages in the imperative ("Cap the premise at premise_max_chars"). One
logical change per commit. PRs describe the behaviour change and include the test that proves it;
`bun test` must pass.

## Documentation

- `README.md` — what it is, requirements, setup, licence. Nothing else goes there.
- `docs/configuration.md` — every option, its default and tuning notes.
- `docs/SDD.md` — design: hooks, data flow, state, decisions.
- `docs/troubleshooting.md` — symptoms, causes, log lines.
- `CHANGELOG.md` — Keep a Changelog format, one entry per release.

## Releasing

Bump `version` in `package.json`, add the CHANGELOG entry, commit, tag `vX.Y.Z` and push the tag.
Installation is `git clone`, so a release is the tag itself.
