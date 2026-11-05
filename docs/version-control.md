# Local version control

The workspace is a Git repository on `main`. The initial commit is `4e6e7ab`, tagged **`baseline-0.28.3`**, before the Web Worker change. Source, tests, docs, build/install tools and release ZIPs are tracked. Generated `dist/`, `.scratch/`, dependencies and compiler output are ignored. No remote has been added.

Inspect history with `git log --oneline --decorate` and local changes with `git status` / `git diff`.

Release tags include **`v0.29.0`** (background flight worker), **`v0.30.0`** (scorpion-tail Manticore and staged venom) and **`v0.31.0`** (quill-tail Manticore and faster parallel tests). Their corresponding ZIPs are tracked in `releases/` for reinstalling a previous build without changing Git branches.

**`v0.31.1`** fixes threatened melee flyers hovering instead of escaping and adds explicit air-to-air combat regression coverage.

To review or restore the baseline without deleting later history, first commit any work you want to retain, then create a separate branch:

```powershell
git switch -c rollback-0.28.3 baseline-0.28.3
npm run build
powershell -File tools/install-module.ps1
```

Reload every Foundry client afterward. Switching Git branches alone does not update the separately installed Foundry module. Use `git switch main` to return to the current development branch, then rebuild/install again. A release archive for the baseline is also tracked at `releases/foundry-creature-ai-0.28.3.zip`.
