# Antigravity Always Run

A VS Code / Antigravity IDE extension that auto-clicks **Accept**, **Run**, **Yes**, **Retry**, **Approve**, and **Confirm** buttons — enabling fully autonomous agent operation.

<a href='https://ko-fi.com/Y8Y61ABMM' target='_blank'>
  <img width='200' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' alt='Support me on Ko-fi' />
</a>

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
3. Click **▶️ Start Auto** — the extension automatically opens DevTools, injects the scanner script, and closes DevTools
4. Toggle individual buttons (Yes / Run / Retry / Accept) as needed
5. Click **🛑 Stop** to pause — click **▶️ Start** again to resume (no re-injection needed)

<a href='https://ko-fi.com/Y8Y61ABMM' target='_blank'>
  <img width='300' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' alt='Support me on Ko-fi' />
</a>

## 🔍 How It Works — Why DevTools?

When you click **Start Auto** for the first time, the extension briefly opens DevTools, pastes a small JavaScript scanner into the console, and closes DevTools. **This is the only way to make it work.** Here's why:

- **VS Code extensions run in a sandbox** — they cannot directly access or interact with the editor's UI buttons (like "Yes", "Run", "Retry" dialogs). The extension API simply does not expose these elements.
- **Chrome DevTools Protocol (CDP)** would be an alternative, but it requires special launcher arguments (`--remote-debugging-port`) which are not available by default in Antigravity IDE or VS Code.
- **The injected script** is a simple DOM scanner that runs every few seconds, finds matching buttons, and clicks them. It communicates with the extension via a local HTTP server (`127.0.0.1`, random port) to receive config updates (start/stop, toggle changes) in real time.

After the first injection, all subsequent **Start / Stop** actions only toggle config — no DevTools interaction is needed again.

## 🛡️ Transparency & Security

We understand that "opening DevTools and pasting a script" may sound suspicious. We want to be fully transparent:

- **📖 100% Open Source** — The entire source code is publicly available. You can inspect every line of the injected script in [`AutoAcceptPanel.ts`](src/AutoAcceptPanel.ts) (search for `_buildInjectScript`).
- **🔒 No network calls** — The scanner only communicates with `127.0.0.1` (your own machine). Zero data is sent to any external server.
- **👀 You can verify** — Open DevTools (`Help > Toggle Developer Tools`) anytime and check the console. You'll see `[AlwaysRun] Scanning...` logs and `[AlwaysRun] Clicked: ...` entries for every action taken.
- **🧹 Nothing persists** — Stop the extension and reload the window — the script is gone. Nothing is installed, modified, or saved outside of the extension's normal operation.

> **Repository:** [github.com/billythekidz/AntigravityAlwaysRun](https://github.com/billythekidz/AntigravityAlwaysRun)

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
