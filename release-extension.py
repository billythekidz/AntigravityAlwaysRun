#!/usr/bin/env python3
"""
Antigravity Always Run - Release Automator

This script:
1. Bumps the patch version in AntigravityAlwaysRun~/package.json
2. Packages the extension into a .vsix using vsce
3. Publishes to Open VSX
4. Creates a GitHub Release and uploads the .vsix

Usage:
  python3 AntigravityAlwaysRun~/release-extension.py
  python3 AntigravityAlwaysRun~/release-extension.py -m "fix: add retry button support"

  (run from the repo root: UnityAntigravityIDE/)

The optional -m/--message flag adds a descriptive summary to the commit and
GitHub release following Conventional Commits convention:
  release(always-run-v1.0.1): fix: add retry button support [skip ci]
Without -m, the commit message defaults to:
  release(always-run-v1.0.1): patch release [skip ci]

NOTE: This script only affects AntigravityAlwaysRun~. It does NOT bump
the root package.json or modify the parent project in any way.
"""

import argparse
import json
import os
import subprocess
import sys

# ─── Resolve paths ───────────────────────────────────────────────────
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = SCRIPT_DIR
EXTENSION_DIR = SCRIPT_DIR

PACKAGE_JSON_PATH = os.path.join(EXTENSION_DIR, "package.json")
SECRETS_FILE = r"D:\GITHUB\UnityAntigravityIDE\.secrets\ovsx-token.txt"

EXTENSION_NAME = "antigravity-always-run"
TAG_PREFIX = "always-run-v"

# ─── Helpers ─────────────────────────────────────────────────────────
CYAN = "\033[0;36m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"

def info(msg):  print(f"{CYAN}{msg}{NC}")
def ok(msg):    print(f"{GREEN}{msg}{NC}")
def warn(msg):  print(f"{YELLOW}{msg}{NC}")
def err(msg):   print(f"{RED}{msg}{NC}", file=sys.stderr)

def run(cmd, cwd=None, check=True):
    """Run a shell command, streaming output."""
    print(f"  $ {cmd}")
    result = subprocess.run(cmd, shell=True, cwd=cwd, check=check)
    return result

# ─── Main ────────────────────────────────────────────────────────────
def main():
    parser = argparse.ArgumentParser(
        description="Antigravity Always Run - Release Automator"
    )
    parser.add_argument(
        "-m", "--message",
        type=str,
        default=None,
        help=(
            "Release description following Conventional Commits convention. "
            "Examples: 'fix: add retry button support', "
            "'feat: per-button toggles', "
            "'chore: update dependencies'"
        )
    )
    args = parser.parse_args()

    info("--- Starting AlwaysRun Release Process ---")
    print(f"Project Root:  {PROJECT_ROOT}")
    print(f"Extension Dir: {EXTENSION_DIR}")

    # 1. Validate environment
    if not os.path.isfile(SECRETS_FILE):
        err(f"Missing Open VSX token at {SECRETS_FILE}. Please ensure .secrets/ovsx-token.txt exists.")
        sys.exit(1)

    with open(SECRETS_FILE, "r") as f:
        ovsx_token = f.read().strip()

    if not ovsx_token:
        err("Open VSX token is empty.")
        sys.exit(1)

    # Check for gh CLI
    try:
        subprocess.run("gh --version", shell=True, capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        warn("Warning: GitHub CLI (gh) is not installed. GitHub Release step will fail.")

    # 2. Bump Version (Patch)
    warn("Bumping version...")
    with open(PACKAGE_JSON_PATH, "r", encoding="utf-8") as f:
        pkg = json.load(f)

    current_version = pkg["version"]
    parts = current_version.split(".")
    parts[2] = str(int(parts[2]) + 1)
    new_version = ".".join(parts)
    pkg["version"] = new_version

    with open(PACKAGE_JSON_PATH, "w", encoding="utf-8") as f:
        json.dump(pkg, f, indent=4, ensure_ascii=False)
        f.write("\n")

    ok(f"Version bumped to v{new_version}")

    # 3. Build commit message & release notes
    description = args.message if args.message else "patch release"
    tag_name = f"{TAG_PREFIX}{new_version}"
    commit_msg = f"release({tag_name}): {description} [skip ci]"
    release_title = f"Antigravity Always Run v{new_version}"
    release_notes = description if args.message else f"Automated release of Antigravity Always Run extension version {new_version}."

    info(f"Commit: {commit_msg}")
    info(f"Release title: {release_title}")

    # 4. Package extension
    warn("Packaging Extension...")
    vsix_name = f"{EXTENSION_NAME}-{new_version}.vsix"
    run(f"npx -y vsce package --no-git-tag-version --no-dependencies -o {vsix_name}", cwd=EXTENSION_DIR)

    vsix_path = os.path.join(EXTENSION_DIR, vsix_name)
    if not os.path.isfile(vsix_path):
        err(f"VSIX file not found: {vsix_path}")
        sys.exit(1)

    ok(f"Packaged: {vsix_name}")

    # ── PUBLISH ENABLED FLAG ──────────────────────────────────
    PUBLISH_ENABLED = True  # Set to True when ready to publish
    # ─────────────────────────────────────────────────────────

    if PUBLISH_ENABLED:
        # 5. Publish to Open VSX
        warn("Publishing to Open VSX...")
        run(f"npx -y ovsx publish {vsix_name} --pat {ovsx_token}", cwd=EXTENSION_DIR)
        ok("Published to Open VSX successfully!")
    else:
        warn("[PUBLISH DISABLED] Skipping Open VSX publish")

    # 6. Git Commit & Push
    warn("Committing changes to Git...")
    run("git add .", cwd=PROJECT_ROOT)
    run(f'git commit --no-verify -m "{commit_msg}"', cwd=PROJECT_ROOT)
    run("git push origin main --no-verify", cwd=PROJECT_ROOT)
    run("git push private main --no-verify", cwd=PROJECT_ROOT)
    run(f"git tag {tag_name}", cwd=PROJECT_ROOT)
    run(f"git push origin {tag_name} --no-verify", cwd=PROJECT_ROOT)
    run(f"git push private {tag_name} --no-verify", cwd=PROJECT_ROOT)

    if PUBLISH_ENABLED:
        # 7. GitHub Release (publish VSIX to the PUBLIC repo for user trust/visibility)
        warn("Creating GitHub Release on PUBLIC repo...")
        relative_vsix = vsix_name
        run(
            f'gh release create "{tag_name}" "{relative_vsix}" '
            f'--repo billythekidz/AntigravityAlwaysRun '
            f'--title "{release_title}" '
            f'--notes "{release_notes}"',
            cwd=PROJECT_ROOT
        )
        ok("GitHub Release created on public repo!")
        info(f"RELEASE COMPLETE: Antigravity Always Run v{new_version} is now LIVE!")
    else:
        warn("[PUBLISH DISABLED] Skipping GitHub Release")
        info(f"VSIX packaged locally: {vsix_name} (not published)")


if __name__ == "__main__":
    main()
