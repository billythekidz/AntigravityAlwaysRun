# Antigravity Always Run

A VS Code / Antigravity IDE extension that auto-clicks **Accept**, **Run**, **Yes**, **Retry**, **Approve**, and **Confirm** buttons — enabling fully autonomous agent operation.

## Features

- 🎯 **Activity bar icon** — click to open the side panel
- ▶️ **One-click toggle** — Start Auto / Stop with a single button
- 🔄 **Per-button controls** — individually enable/disable Yes, Run, and Retry
- 🔍 **Deep scan** — searches iframes and webview elements every 3 seconds
- ⚠️ **Risk warning** — collapsible banner with safety guidelines (auto-detects English/Vietnamese)
- 📋 **Activity log** — tracks clicks and scan cycles (last 50 entries)

## Install

### From VSIX

```bash
code --install-extension antigravity-always-run-1.0.0.vsix
```

Or: Extensions sidebar → `...` menu → **Install from VSIX** → select the `.vsix` file.

### Build from source

```bash
npm install
npm run compile
npx -y @vscode/vsce package --no-dependencies
```

## Usage

1. Click the 🎯 icon in the **activity bar** (left sidebar)
2. The side panel opens with controls and a risk warning
3. Click **▶️ Start Auto** — the script is copied to clipboard
4. Paste into **DevTools console** (`F12`) to activate scanning
5. Toggle individual buttons (Yes / Run / Retry) as needed
6. Click **🛑 Stop** to halt the auto-clicker

## ⚠️ Warning

You are **fully responsible** when running the agent autonomously. Risks include:

- 🔥 Your project may be destroyed or modified unexpectedly
- 💾 Other drives or projects on your machine may be affected
- 💸 Antigravity model quota will be consumed very quickly

**Recommended:** Use the [Google AI Ultra](https://gamikey.com/nang-cap-google-ai-tro-ly-thong-minh-member-slot/?ref=theaux) plan and set up proper rules for the agent before enabling auto mode.

## Reference

Based on the original gist by **@cotamatcotam**:

> <https://gist.github.com/cotamatcotam/2b080b7c34a5d07c314a4c2978d7f0cd>

## License

MIT
