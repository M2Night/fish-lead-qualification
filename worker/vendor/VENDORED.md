# Vendored dependencies

## voice-agent-core

A vendored (plain-copy) snapshot of the private repo, so the worker's build context is
self-contained — no external/private fetch needed at deploy/build time (LiveKit Cloud
Agents / Render / Docker). This mirrors the convention used in `voice-agent-workbench`.

- **Upstream:** https://github.com/M2Night/voice-agent-core
- **Vendored version:** `0.2.1` (copied from the workbench vendor, upstream commit `3f76db0`).
- **Method:** plain copy of `src/`, `pyproject.toml`, `README.md` (NOT `git subtree`).
- **Referenced by:** `worker/pyproject.toml` as a local path dependency.

### Sync to a newer upstream
1. `cp -r` the desired commit's `src/`, `pyproject.toml`, `README.md` over this directory.
2. `uv lock` in `worker/`.
3. Update the version/commit noted above.

### Alternative (single-source)
Swap the path dependency for a git dependency
(`voice-agent-core @ git+https://github.com/M2Night/voice-agent-core.git@<commit>`). Cleaner
to update, but the deploy build then needs credentials to fetch the private repo.
