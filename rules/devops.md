# DevOps Rules

## Branches

The repository has one long-lived branch:

```text
main
```

Rules:

- `main` is the default GitHub branch and the normal local branch.
- Do not create, push, or revive `master`.
- Do not keep duplicate long-lived branches with the same content.
- Feature branches are allowed only when a PR workflow is explicitly requested.
- Feature branch names should use `codex/<short-description>`.

If both `main` and `master` appear on GitHub:

1. Confirm `origin/main` and `origin/master` point at the same commit.
2. Confirm GitHub default branch is `main`.
3. Delete remote `master`.
4. Rename local `master` to `main` if needed.
5. Set local tracking to `origin/main`.

Useful commands:

```bash
git branch --all --verbose --no-abbrev
git remote show origin
git branch -m master main
git branch --set-upstream-to=origin/main main
git push origin --delete master
git fetch --prune origin
```

## Publishing

Before pushing:

1. Run `git status --short --branch`.
2. Inspect the changed files with `git diff --stat` and `git diff --name-status`.
3. Do not stage unrelated local changes silently.
4. Commit intentionally with a terse Conventional Commit-style message.
5. Push to `origin main`.

Normal push command:

```bash
git push origin main
```

Only use force push when fixing branch history that is already understood and confirmed, and prefer:

```bash
git push --force-with-lease origin <local-branch>:<remote-branch>
```

Never use plain `--force`.

## npm Package

The installable CLI contract is:

```bash
npm install -g github:doingstarman/benchy
benchy
```

Rules:

- `package.json` must expose `"bin": { "benchy": "./dist/cli.js" }`.
- `src/cli.ts` must keep `#!/usr/bin/env node` as the first line so the compiled npm bin is executable.
- `benchy` with no subcommand starts the production server on `4242`; `benchy start` remains an explicit equivalent.
- `package.json` `files` must include `dist` and `frontend/dist` so the published package can serve the built app.
- `prepare` must run `npm run build` so `npm install -g github:doingstarman/benchy` builds `dist/cli.js` from a git checkout.
- Do not also run the same build in `prepack`; `npm pack` invokes `prepare`, and duplicating it doubles install/pack time.
- Production builds must use `tsconfig.build.json` or an equivalent build-only config so tests are not emitted into `dist` or packed to npm.
- Keep Node engine requirements aligned with the project runtime (`>=22` unless the stack changes).
- Do not document `npm install -g benchy` until this project owns and publishes the `benchy` package on the public npm registry.

## Required Checks

For code changes, run both before pushing:

```bash
npm test
npm run build
```

For type-only or broad TypeScript changes, also run:

```bash
npm run lint
```

For documentation-only changes, checks may be skipped, but the final summary must say they were skipped because only docs changed.

## GitHub Repository

Remote:

```text
https://github.com/doingstarman/benchy.git
```

Expected state:

- `origin/HEAD` points to `origin/main`.
- Local `main` tracks `origin/main`.
- `git status --short --branch` shows `## main...origin/main` when clean.

## Secrets

Never commit real provider API keys or user credentials.

Allowed local/demo values:

- `mock-key`
- `http://localhost:4243/api/mock`
- temp test directories controlled by `BENCHY_DIR`

Dev provider credentials live in `~/.benchy-dev/config.json`. Production credentials live in `~/.benchy/config.json`. Frontend code must never read or embed them directly.
