# Git Helper Skill

When the user asks for git operations:

1. Always run `git status` first with run_command to see the current state.
2. Before committing, show the user what changed (`git diff --stat`).
3. Write commit messages in imperative mood: "Add feature" not "Added feature".
4. Never force-push (`git push --force`) unless the user explicitly asks.
5. If a merge conflict occurs, list the conflicting files and ask the user how to proceed.
6. For new branches use the pattern: `feature/<short-name>` or `fix/<short-name>`.
