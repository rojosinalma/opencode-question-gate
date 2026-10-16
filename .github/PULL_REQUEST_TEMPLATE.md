<!-- Title: a plain imperative sentence describing the behaviour change, e.g. "Cap the premise at premise_max_chars". -->

## What

<!-- One or two sentences. Link the issue: Closes #123 -->

## Why

## Checklist

- [ ] `bun test` passes locally
- [ ] A test covers the change when it touches text counting, turn keys or premise recovery
- [ ] `docs/configuration.md` updated when an option or default changed
- [ ] `CHANGELOG.md` has an entry under *Unreleased*
- [ ] Commits are GPG-signed
- [ ] The hook still fails open (any internal fault logs and lets the call through)
