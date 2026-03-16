---
description: Build, bump version, and publish the AlwaysRun extension to Open VSX and GitHub.
---

# Publish Antigravity Always Run Extension

This workflow automates the entire release cycle of the extension.

0. Before running the release script, summarize the changes made in this session into a short Conventional Commits message (e.g. `fix: add retry button support`, `feat: per-button toggles`). This message will be passed as the `-m` argument.

// turbo
1. Run the release script with the commit message:
   - Command: `python3 AntigravityAlwaysRun~/release-extension.py -m "<commit message>"`
   - Directory: Root directory of `UnityAntigravityIDE`
   - Replace `<commit message>` with the summary from step 0.

2. Verify the output:
   - Wait for the script to finish bumping the version.
   - Confirm successful publication to Open VSX.
   - Confirm creation of the GitHub Release and Tag (prefix: `always-run-v`).

3. Notify the user:
   - Provide the new version number.
   - Provide the link to the Open VSX page: `https://open-vsx.org/extension/antigravity-unity/antigravity-always-run`.
   - Provide the link to the GitHub Releases page.
