---
activation: Model Decision
description: Ensures that AlwaysRun releases use the centralized release-extension.py script.
---

# Extension Release Management

Whenever you need to publish or release a new version of the **Antigravity Always Run** extension to Open VSX or GitHub, you MUST use the centralized release script.

## 📜 Release Script
Target: `AntigravityAlwaysRun~/release-extension.py` (cross-platform, run from the repo root).

## 📝 Commit Message Convention
The script accepts an optional `-m` / `--message` flag for a descriptive release summary following **Conventional Commits**:

```bash
python3 AntigravityAlwaysRun~/release-extension.py -m "feat: add per-button toggles"
```

This produces a commit like:
```
release(always-run-v1.0.2): feat: add per-button toggles [skip ci]
```

### When writing the `-m` message:
- Use a Conventional Commits prefix: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `perf:`, `style:`, `test:`
- Keep it concise (under 72 characters after the prefix)
- Describe **what changed**, not implementation details
- Examples:
  - `fix: resolve retry button not being detected`
  - `feat: add per-button toggle controls`
  - `chore: update dependencies and clean up build`

If `-m` is omitted, the commit defaults to `release(always-run-vX.Y.Z): patch release [skip ci]`.

## 🚀 Behavior
1. **Never** manually run `ovsx publish` or `vsce package` if the goal is a formal release.
2. **Never** manually create GitHub tags or releases for this extension.
3. Instead, run `python3 AntigravityAlwaysRun~/release-extension.py` from the repo root.
4. **Always** provide a `-m` message describing the changes in the release.
5. The script automatically:
   - Bumps the patch version in `AntigravityAlwaysRun~/package.json`.
   - Packages the `.vsix`.
   - Publishes to Open VSX.
   - Commits with the formatted message, tags (prefix: `always-run-v`), and pushes.
   - Creates a GitHub Release with the `.vsix` attached.

## ⚠️ Scope
This script **only** affects `AntigravityAlwaysRun~/`. It does NOT bump the root `package.json` or modify the parent project.

## 🛠️ Verification
Before running the script, ensure:
- The `ovsx-token.txt` is present in `.secrets/`.
- GitHub CLI (`gh`) is authenticated.
- You have reviewed the latest changes in the README.
