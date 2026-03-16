# Antigravity Always Run — Autonomous Agent Auto-Clicker

Auto-clicks **Yes**, **Run**, **Retry**, **Accept**, **Approve**, and **Confirm** buttons so your AI agent can work fully autonomously — no human babysitting required.

<a href='https://ko-fi.com/Y8Y61ABMM' target='_blank'>
  <img width='200' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' alt='Support me on Ko-fi' />
</a>

---

## 🚀 Install

1. Open **Antigravity IDE** (or VS Code)
2. Go to **Extensions** sidebar (`Ctrl+Shift+X`)
3. Search **"Antigravity Always Run"** and click **Install**

Or install from [Open VSX](https://open-vsx.org/extension/antigravity-unity/antigravity-always-run) or [GitHub Releases](https://github.com/billythekidz/AntigravityAlwaysRun/releases/latest).

---

## ✨ Features

- 🎯 **Activity bar icon** — click to open the side panel
- ▶️ **One-click toggle** — Start / Stop with a single button
- 🔄 **Per-button controls** — individually enable/disable Yes, Run, Retry, Accept
- 🔍 **Deep scan** — searches main window, iframes, shadow DOM, and webviews
- ⚠️ **Risk warning** — collapsible safety banner (auto-detects English/Vietnamese)
- 📋 **Activity log** — tracks every click with timestamps (last 50 entries)
- 🔢 **Click counter** — shows total auto-clicked buttons in real time

---

## 📖 Usage

1. Click the **🎯 Always Run** icon in the activity bar (left sidebar)
2. The side panel opens with controls and a risk warning
3. Click **▶️ Start Auto** — the extension handles everything automatically
4. Toggle individual buttons (**Yes** / **Run** / **Retry** / **Accept**) as needed
5. Click **🛑 Stop** to pause — click **▶️ Start** again to resume instantly

<a href='https://ko-fi.com/Y8Y61ABMM' target='_blank'>
  <img width='300' src='https://storage.ko-fi.com/cdn/kofi2.png?v=6' alt='Support me on Ko-fi' />
</a>

---

## 🔍 How It Works — Why DevTools?

When you click **Start Auto** for the first time, the extension briefly opens DevTools, injects a small JavaScript scanner, and closes DevTools. **This is the only way to make it work:**

- **VS Code extensions run in a sandbox** — they cannot access the editor's own UI buttons (like "Yes", "Run", "Retry" dialogs). The extension API does not expose these elements.
- **Chrome DevTools Protocol (CDP)** would be an alternative, but requires special launcher arguments (`--remote-debugging-port`) not available by default.
- **The injected script** is a lightweight DOM scanner. It communicates with the extension via a local HTTP server (`127.0.0.1`, random port) to receive config updates in real time.

After the first injection, all subsequent **Start / Stop** actions only toggle config — **no DevTools interaction is needed again**.

---

## 🔧 Manual Setup (if auto-inject fails)

On some platforms (especially macOS), the automatic injection may fail due to OS permission restrictions. You can manually inject the script:

1. **Open the side panel** → click **▶️ Start Auto** (this generates the script)
2. Expand the **🔧 Manual Setup** section in the panel
3. Click **🔧 Open DevTools** button
4. Click the **Console** tab in DevTools
5. If you see _"Warning: Don't paste code..."_, type `allow pasting` and press Enter
6. Click **📋 Copy** to copy the injection script
7. Paste into the Console:
   - **Windows / Linux:** `Ctrl+V`
   - **macOS:** `⌘+V`
   - Or right-click → Paste
8. Press **Enter** — you should see `[AlwaysRun] Injected.` in the console
9. DevTools will close automatically once confirmed

---

## 🛡️ Transparency & Security

We understand that "opening DevTools and pasting a script" may raise concerns. We want to be fully transparent:

- **📖 100% Open Source** — Every line of code is public. You can inspect the injected script in [`AutoAcceptPanel.ts`](src/AutoAcceptPanel.ts) (search for `_buildInjectScript`).
- **🔒 No external network calls** — The scanner only communicates with `127.0.0.1` (your own machine). Zero data is sent to any external server.
- **👀 Verify anytime** — Open DevTools (`Help > Toggle Developer Tools`) and check the console. You'll see `[AlwaysRun] Scanning...` logs for every cycle and `[AlwaysRun] Clicked: ...` for every action taken.
- **🧹 Nothing persists** — Reload the window and the script is gone. Nothing is installed or saved outside of the extension's normal operation.

> **Source Code:** [github.com/billythekidz/AntigravityAlwaysRun](https://github.com/billythekidz/AntigravityAlwaysRun)

---

## ⚠️ Warning

You are **fully responsible** when running the agent autonomously. Risks include:

- 🔥 Your project may be destroyed or modified unexpectedly
- 💾 Other drives or projects on your machine may be affected
- 💸 AI model quota will be consumed very quickly

**Recommended:** Use the [Google AI Ultra](https://gamikey.com/nang-cap-google-ai-tro-ly-thong-minh-member-slot/?ref=theaux) plan and set up proper rules for the agent before enabling auto mode.

---

## 🏗️ Build from source

```bash
npm install
npm run compile
npx -y @vscode/vsce package --no-dependencies
```

---

## 🙏 Credits

Based on the original gist by **@cotamatcotam**:

> <https://gist.github.com/cotamatcotam/2b080b7c34a5d07c314a4c2978d7f0cd>

---

## 📝 Open Source

- **Repository**: [github.com/billythekidz/AntigravityAlwaysRun](https://github.com/billythekidz/AntigravityAlwaysRun)
- **Issues & Requests**: [GitHub Issues](https://github.com/billythekidz/AntigravityAlwaysRun/issues)
- **License**: MIT

*Keywords: auto click, auto accept, always run, autonomous agent, antigravity ide, vscode, ai coding assistant, auto approve*
