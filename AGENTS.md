# Project workflow

The user wants completed work committed and pushed to GitHub by default.

- After finishing changes and appropriate verification, commit the task's files and push the current branch to `origin` (`https://github.com/romaogo-sallah/foundry-creature-ai.git`).
- Push release tags created for that completed work as well. Keep release archives and verification records with their release commits.
- Preserve unrelated user changes. Do not force-push or rewrite published history.
- If authentication, permissions, remote changes or checks block a push, report the actual blocker and keep the completed local commit available.
- Never commit credentials, Foundry world databases, `.scratch/`, or generated `dist/` files.
