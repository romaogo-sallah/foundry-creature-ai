# Version control and GitHub

The workspace is a Git repository on `main`, with `origin` pointing to the public [GitHub repository](https://github.com/romaogo-sallah/foundry-creature-ai). The initial commit is `4e6e7ab`, tagged **`baseline-0.28.3`**, before the Web Worker change. Source, tests, docs, build/install tools and release ZIPs are tracked. Generated `dist/`, `.scratch/`, dependencies and compiler output are ignored.

Completed, verified work is committed and pushed to `origin` by default, including new release tags. The project instructions in [AGENTS.md](../AGENTS.md) preserve this preference for future sessions. Pushes preserve published history; a blocked push is reported rather than silently left local.

Inspect history with `git log --oneline --decorate` and local changes with `git status` / `git diff`.

Release tags include **`v0.29.0`** (background flight worker), **`v0.30.0`** (scorpion-tail Manticore and staged venom) and **`v0.31.0`** (quill-tail Manticore and faster parallel tests). Their corresponding ZIPs are tracked in `releases/` for reinstalling a previous build without changing Git branches.

**`v0.31.1`** fixes threatened melee flyers hovering instead of escaping and adds explicit air-to-air combat regression coverage.

**`v0.36.0`** separates manual rules from Creature AI into five packages. The complete release is `releases/pf2e-tactical-suite-0.36.0.zip`. The immediately preceding monolithic checkpoint is **`v0.35.0`** (`428b64f`). The suite installer also archives existing module folders under `.scratch/suite-install-backup-<timestamp>/` before replacing them. To restore a monolithic release, disable the four Tactical Rules modules, restore the earlier AI package and restart Foundry; do not run the older all-in-one AI alongside the new manual modules.

To review or restore the baseline without deleting later history, first commit any work you want to retain, then create a separate branch:

```powershell
git switch -c rollback-0.28.3 baseline-0.28.3
npm run build
powershell -File tools/install-module.ps1
```

Reload every Foundry client afterward. Switching Git branches alone does not update the separately installed Foundry module. Use `git switch main` to return to the current development branch, then rebuild/install again. A release archive for the baseline is also tracked at `releases/foundry-creature-ai-0.28.3.zip`.
