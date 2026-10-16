# Security

## Reporting a vulnerability

Report security issues privately through GitHub's vulnerability reporting: open the repository's
**Security** tab and choose *Report a vulnerability*, or go straight to
<https://github.com/rojosinalma/opencode-question-gate/security/advisories/new>. Never file a
security problem as a public issue.

Include what the plugin does wrong, how to reproduce it (the `opencode.jsonc` options and a
transcript if relevant) and the version (`package.json` or the tag). I acknowledge reports as soon as
I read them and publish a fix with a new release and a CHANGELOG entry.

## Supported versions

Only the latest release receives fixes. Upgrade with `git pull` in the plugin directory and restart
the OpenCode server.

## Scope

The plugin runs inside the OpenCode server with that process's privileges and reads the session
transcript to count visible text and recover a premise. It never sends data anywhere and has no
network access of its own. Anything that lets a model or a transcript bypass the gate, crash the
server or leak transcript content through the injected premise is in scope.
