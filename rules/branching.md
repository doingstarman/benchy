# Branch & Switching Rules

Companion to [devops.md](devops.md), which owns `main`/`master` hygiene, publishing, and the release ritual. This file is narrower: **moving between branches without dragging work where it doesn't belong** — the failure mode being an unrelated fix landing on a feature branch that is about something else.

## The rule everything else serves

**One branch = one concern, based on `main`.** A branch name (`codex/<short-desc>`) is a promise about what's in it. Anything that doesn't serve that promise belongs on a different branch.

## Before touching code

1. Know where you are — `git branch --show-current`.
2. Know the tree is clean — `git status --short`. A dirty tree is unfinished work; deal with it (commit / stash / discard) before starting something new. Never start a second concern on top of a first one's uncommitted changes.
3. Know your base. Feature branches start from an up-to-date `main`, **never from another feature branch** (that silently inherits its commits):

```bash
git checkout main
git fetch origin && git merge --ff-only origin/main   # or: git pull --ff-only
git checkout -b codex/<short-desc>
```

## While working

- **Stay on-concern.** If mid-task you spot an unrelated fix, do NOT just make it here — use "Recipe: wrong branch" below.
- **Keep build artifacts out of feature commits.** `dist/` and `frontend/dist/` are release outputs, rebuilt on `main` at release time (see devops.md). If a local build dirtied them, don't stage them on a feature branch.
- **Commit only when asked** (repo-wide convention).

## Switching away from a branch

Never carry uncommitted work across a switch by accident.

1. `git status --short` — decide per file: commit, stash, or discard.
2. Watch for dirty build artifacts. If `dist/` or `frontend/dist/` show modified from a stray build, restore them before switching so they don't follow you:

```bash
git checkout -- dist frontend/dist
git clean -fd dist frontend/dist          # removes untracked bundle files
```

3. Switch, then **verify** you landed where you meant and the tree looks right:

```bash
git checkout <target>
git branch --show-current
git status --short --branch
```

Files you didn't intend to change should not differ. If the working tree "reverts" unexpectedly after a switch, that is the target branch's own content — expected, not a loss. Your work is safe on the other branch.

## Recipe: made changes on the wrong branch

Move only the files you meant to change; leave build-artifact noise behind.

```bash
git stash push -- path/to/file.tsx            # stash just the intended file(s)
git checkout main                             # base from main, not the wrong branch
git checkout -b codex/<right-desc>
git stash pop
git add path/to/file.tsx && git commit -m "…"
```

## Recipe: merge a feature into `main` (keep history linear)

`main` prefers linear history.

- Branch is directly ahead of `main` → fast-forward:

```bash
git checkout main && git merge --ff-only codex/<desc>
```

- Branch shares `main`'s base but `main` moved on (a second feature already landed) → do **not** make a merge commit. Cherry-pick the commit(s), or rebase the branch onto `main` first:

```bash
git checkout main && git cherry-pick <sha>            # single commit
# or: git checkout codex/<desc> && git rebase main && git checkout main && git merge --ff-only codex/<desc>
```

Cherry-pick rewrites the hash: the branch then reads "unmerged" against `main` even though its content shipped — cosmetic, not a problem.

Never merge to `main` or release without the two gates from devops.md: the user's **dev eyeball** and an explicit **"кати"**.

## After merge

Merged branches are duplicates — delete them, don't accumulate:

```bash
git branch -d codex/<desc>                    # -d refuses unless truly merged
git branch -D codex/<desc>                    # only when you KNOW it shipped (e.g. cherry-picked, so -d won't see it)
git push origin --delete codex/<desc>         # if it had a remote
```

## Docs-only exception

A pure documentation or comment change (no code, no build output, nothing packed into the npm artifact) may be committed to `main` directly — say in the summary that checks were skipped because only docs changed. Everything else takes a branch.
