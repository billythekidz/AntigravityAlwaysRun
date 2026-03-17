import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { NativeClickHandler } from './NativeClickHandler';
import { ConfigServer } from './ConfigServer';


/** Returns the workspace folder name (used as badge label and config key). */
function getProjectName(): string {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return path.basename(folders[0].uri.fsPath);
    }
    return 'Unknown';
}

/** Fixed exclude list — same for all projects. */
const DEFAULT_EXCLUDES = ['always run', 'always allow', 'always deny'];


export class AutoAcceptPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'antigravity-always-run.panel';

    private _view?: vscode.WebviewView;
    private _isRunning = false;
    private _scanIntervalMs = 3000;

    private _native: NativeClickHandler;
    private _configPath: string;
    private _configServer: ConfigServer;
    private _scriptInjected = false;

    private _toggles = { yes: true, run: true, retry: true, accept: true, allow: true };
    private _autoScroll = true;

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._native = new NativeClickHandler();
        this._configPath = path.join(os.tmpdir(), 'agy-config.json');
        this._configServer = new ConfigServer();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media'),
                vscode.Uri.joinPath(this._extensionUri, 'assets')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Send project name (folder name) to badge
        this._postToWebview({ command: 'projectProfile', profile: { projectName: getProjectName(), label: getProjectName(), description: '', emoji: '📁', defaultToggles: { yes: true, run: true, retry: true, accept: true, allow: true } } });

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case 'start':
                    this.startAutoScan();
                    break;
                case 'stop':
                    this.stopAutoScan();
                    break;
                case 'toggleUpdate':
                    this._toggles = message.toggles;
                    this._syncConfig();  // push update to config server immediately
                    break;
                case 'intervalChange':
                    this._scanIntervalMs = Math.max(500, Math.min(10000000, message.intervalMs));
                    this._syncConfig();
                    break;
                case 'scrollToggle':
                    this._autoScroll = !!message.autoScroll;
                    this._syncConfig();
                    break;
                case 'diagnose':
                    this._runDiagnosis();
                    break;
                case 'log':
                    console.log(`[Always Run] ${message.text}`);
                    break;
                case 'showInfo':
                    vscode.window.showInformationMessage(message.text);
                    break;
                case 'openExternal':
                    vscode.env.openExternal(vscode.Uri.parse(message.url));
                    break;
                case 'openDevTools':
                    vscode.commands.executeCommand('workbench.action.toggleDevTools');
                    break;
                case 'requestManualScript':
                    // Generate and send the injection script to the webview
                    this._configServer.start().then(port => {
                        const matchers: string[] = [];
                        if (this._toggles.yes) { matchers.push('yes'); }
                        if (this._toggles.run) { matchers.push('run'); }
                        if (this._toggles.retry) { matchers.push('retry'); }
                        if (this._toggles.accept) { matchers.push('accept'); }
                        if (this._toggles.allow) { matchers.push('allow this conversation'); }
                        const liveCfg = {
                            active: true,
                            matchers,
                            excludes: DEFAULT_EXCLUDES,
                            intervalMs: this._scanIntervalMs
                        };
                        this._configServer.update(liveCfg);
                        const script = this._buildInjectScript(port, liveCfg);
                        this._postToWebview({ command: 'manualScript', script });
                    }).catch(() => {
                        this._postToWebview({ command: 'manualScript', script: '// Error: could not start config server' });
                    });
                    break;
                case 'copyScript':
                    if (message.script) {
                        vscode.env.clipboard.writeText(message.script);
                    }
                    break;
                case 'manualStart':
                    this._manualStart();
                    break;
            }
        });
    }

    private async _runDiagnosis() {
        const log = (msg: string, type = 'info') => this._postToWebview({ command: 'diagLog', text: msg, logType: type });

        log('🔬 Starting extension host diagnosis...', 'info');

        // 1. Test require('electron')
        let electron: any;
        try {
            electron = require('electron');
            log('✅ require("electron") OK — keys: ' + Object.keys(electron).join(', '), 'success');
        } catch (e: any) {
            log('❌ require("electron") FAILED: ' + e.message, 'error');
            log('⚠️ Cannot access Electron APIs from extension host. Need alternative approach.', 'warning');
            return;
        }

        // 2. Test BrowserWindow.getAllWindows()
        let windows: any[];
        try {
            windows = electron.BrowserWindow.getAllWindows();
            log(`✅ BrowserWindow.getAllWindows() — ${windows.length} window(s)`, 'success');
            windows.forEach((w: any, i: number) => {
                try { log(`   Window[${i}]: "${w.getTitle()}" id=${w.id}`, 'info'); } catch { }
            });
        } catch (e: any) {
            log('❌ BrowserWindow.getAllWindows() FAILED: ' + e.message, 'error');
            return;
        }

        if (windows.length === 0) {
            log('❌ No windows found — cannot execute scripts', 'error');
            return;
        }

        // 3. Test executeJavaScript on each window
        const testScript = `JSON.stringify({ title: document.title, url: location.href, ok: true })`;
        for (let i = 0; i < windows.length; i++) {
            const win = windows[i];
            try {
                const result = await win.webContents.executeJavaScript(testScript, true);
                log(`✅ Window[${i}] executeJavaScript OK: ${result}`, 'success');
            } catch (e: any) {
                log(`❌ Window[${i}] executeJavaScript FAILED: ${e.message}`, 'error');
            }
        }
        log('🔬 Diagnosis complete.', 'info');
    }


    public toggleAutoClick() {
        if (this._isRunning) {
            this.stopAutoScan();
        } else {
            this.startAutoScan();
        }
    }

    public stopAutoClick() {
        this.stopAutoScan();
    }

    public async injectScript() {
        // Now just starts auto-scan instead of clipboard copy
        this.startAutoScan();
    }

    // ==================== CORE: Config Server + DevTools Injection ====================

    // ==================== CORE: Temp-file Config + DevTools Injection ====================

    /**
     * Push current panel state to the ConfigServer (HTTP) and also write
     * to agy-config.json as a fallback.
     * The injected script reads config via fetch() from ConfigServer every 1s.
     */
    private _syncConfig() {
        const matchers: string[] = [];
        if (this._toggles.yes) { matchers.push('yes'); }
        if (this._toggles.run) { matchers.push('run'); }
        if (this._toggles.retry) { matchers.push('retry'); }
        if (this._toggles.accept) { matchers.push('accept'); }
        if (this._toggles.allow) { matchers.push('allow this conversation'); }
        const cfg = {
            active: this._isRunning,
            matchers,
            excludes: DEFAULT_EXCLUDES,
            intervalMs: this._scanIntervalMs,
            autoScroll: this._autoScroll
        };
        this._configServer.update(cfg);
        try { fs.writeFileSync(this._configPath, JSON.stringify(cfg), 'utf8'); } catch { }
    }

    /**
     * Build the one-time injection script.
     * - Config file is re-read every 1s (cheap, no DevTools round-trips)
     * - Scan runs at the user-configured interval (default 3s)
     * - Interval and active state both come from the file — no re-injection
     */
    private _buildInjectScript(serverPort: number, liveCfg: { active: boolean; matchers: string[]; excludes: string[]; intervalMs: number }): string {
        const cfgJson = JSON.stringify(liveCfg);
        return `(function() {
  if (window.__agyTimer)      { clearInterval(window.__agyTimer);      window.__agyTimer = null; }
  if (window.__agyCfgTimer)   { clearInterval(window.__agyCfgTimer);   window.__agyCfgTimer = null; }

  var SERVER = 'http://127.0.0.1:${serverPort}';
  // Live config embedded at injection time
  window.__agyConfig = ${cfgJson};
  window.__agyScanInterval = window.__agyConfig.intervalMs || 3000;

  // Config reader via HTTP (every 1s) — replaces require('fs') which is unavailable in renderer
  function readConfig() {
    fetch(SERVER).then(function(r){return r.json();}).then(function(cfg){
      Object.assign(window.__agyConfig, cfg);
    }).catch(function(){});
  }

  // DOM scanner
  function scanDoc(doc, label) {
    try {
      var btns = doc.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) {
        var b = btns[i];
        var txt = ((b.textContent||'')+(b.getAttribute('aria-label')||'')+(b.getAttribute('title')||'')).toLowerCase().trim();
        var cs = b.ownerDocument.defaultView ? b.ownerDocument.defaultView.getComputedStyle(b) : null;
        if (!txt || b.disabled || b.dataset.agyClicked || (cs && (cs.display==='none' || cs.visibility==='hidden'))) { continue; }
        if (window.__agyConfig.excludes.some(function(e){return txt.indexOf(e)!==-1;})) { continue; }
        if (window.__agyConfig.matchers.some(function(m){return txt.indexOf(m)!==-1;})) {
          b.dataset.agyClicked = '1';
          b.click();
          setTimeout(function(){try{delete b.dataset.agyClicked;}catch(e){}}, 5000);
          console.log('[AlwaysRun] Clicked:', txt.substring(0,50), '|', label);
          // Report click to extension host for panel UI count
          fetch(SERVER + '/clicked', {method:'POST', body:JSON.stringify({text:txt.substring(0,50),source:label})}).catch(function(){});
        }
      }
    } catch(e) {}
  }

  // Scroll chat containers to bottom to force virtualized buttons into DOM
  function scrollToBottom() {
    try {
      // VS Code chat panel scrollable containers
      var selectors = [
        '.monaco-list-rows',
        '.chat-widget .monaco-scrollable-element',
        '[role="list"]',
        '.interactive-list',
        '.scm-editor-container'
      ];
      function doScroll(root) {
        selectors.forEach(function(sel) {
          try {
            var els = root.querySelectorAll(sel);
            els.forEach(function(el) {
              if (el.scrollHeight > el.clientHeight) {
                el.scrollTop = el.scrollHeight;
              }
            });
          } catch(e) {}
        });
      }
      doScroll(document);
      // Also scroll inside shadow DOMs
      (function sd(root,d){if(d>3)return;try{root.querySelectorAll('*').forEach(function(el){
        if(el.shadowRoot){doScroll(el.shadowRoot);sd(el.shadowRoot,d+1);}
      });}catch(e){};})(document,0);
    } catch(e) {}
  }

  function scanAll() {
    if (!window.__agyConfig.active) { return; }
    if (window.__agyConfig.autoScroll !== false) { scrollToBottom(); }
    console.log('[AlwaysRun] Scanning... matchers:', window.__agyConfig.matchers.join(','));
    scanDoc(document, 'main');
    document.querySelectorAll('iframe').forEach(function(f,i){
      try{scanDoc(f.contentDocument||f.contentWindow.document,'iframe-'+i);}catch(e){}
    });
    (function sd(root,d){if(d>4)return;try{root.querySelectorAll('*').forEach(function(el){
      if(el.shadowRoot){scanDoc(el.shadowRoot,'shadow');sd(el.shadowRoot,d+1);}
    });}catch(e){};})(document,0);
    document.querySelectorAll('webview').forEach(function(w,i){try{scanDoc(w.contentDocument,'wv-'+i);}catch(e){}});

    var newMs = window.__agyConfig.intervalMs || 3000;
    if (newMs !== window.__agyScanInterval) {
      clearInterval(window.__agyTimer);
      window.__agyScanInterval = newMs;
      window.__agyTimer = setInterval(scanAll, window.__agyScanInterval);
    }
  }

  readConfig();
  window.__agyCfgTimer = setInterval(readConfig, 1000);
  window.__agyTimer = setInterval(scanAll, window.__agyScanInterval);
  scanAll();
  console.log('[AlwaysRun] Injected. Server:', SERVER);

  // Signal extension host that injection succeeded (POST /signali   fetch(SERVER + '/signal', {method:'POST'}).catch(function(){});
})();`;
    }

    public startAutoScan() {
        if (this._isRunning) { return; }
        this._isRunning = true;
        this._syncConfig();   // write active=true to temp file
        this._postToWebview({ command: 'started' });

        if (this._scriptInjected) {
            // Script already running — HTTP config update is enough (polled within 1s)
            this._postToWebview({ command: 'diagLog', text: '\u25b6 Resumed (config server updated)', logType: 'success' });
            return;
        }

        // First time: start ConfigServer + inject via DevTools
        this._postToWebview({ command: 'diagLog', text: '\ud83d\udc89 First start — injecting script via DevTools...', logType: 'info' });
        const matchers: string[] = [];
        if (this._toggles.yes) { matchers.push('yes'); }
        if (this._toggles.run) { matchers.push('run'); }
        if (this._toggles.retry) { matchers.push('retry'); }
        if (this._toggles.accept) { matchers.push('accept'); }
        const liveCfg = {
            active: true,
            matchers,
            excludes: DEFAULT_EXCLUDES,
            intervalMs: this._scanIntervalMs
        };

        this._configServer.update(liveCfg);
        // Wire up click reporting: injected JS → POST /clicked → panel UI
        this._configServer.onClicked((data: any) => {
            this._postToWebview({
                command: 'scanResult',
                clicked: 1,
                found: [{ text: data.text || '?', source: data.source || 'unknown' }]
            });
        });
        this._configServer.start().then(port => {
            const script = this._buildInjectScript(port, liveCfg);

            // macOS: use VS Code API to avoid Accessibility permission requirements
            if (os.platform() === 'darwin') {
                this._injectViaMacOS(script).then(ok => {
                    if (ok) {
                        this._scriptInjected = true;
                        this._postToWebview({ command: 'diagLog', text: '\u2705 Injected — config via HTTP port ' + port, logType: 'success' });
                    } else {
                        this._postToWebview({ command: 'scanError', message: 'Injection not confirmed (user may not have pasted)' });
                        this._isRunning = false;
                        this._syncConfig();
                        this._postToWebview({ command: 'stopped' });
                    }
                });
                return;
            }

            // Windows / Linux: use NativeClickHandler (PowerShell / xdotool)
            const encoded = Buffer.from(script).toString('base64');
            const projectName = vscode.workspace.workspaceFolders?.[0]?.name ?? '';
            this._native.openDevToolsAndInject(encoded, projectName).then(result => {
                if (result.error) {
                    this._postToWebview({ command: 'scanError', message: result.error });
                    this._isRunning = false;
                    this._syncConfig();
                    this._postToWebview({ command: 'stopped' });
                    return;
                }
                if (result.diag?.length) {
                    for (const line of result.diag) {
                        this._postToWebview({ command: 'diagLog', text: line, logType: 'info' });
                    }
                }
                this._scriptInjected = true;
                this._postToWebview({ command: 'diagLog', text: '\u2705 Injected — config via HTTP port ' + port, logType: 'success' });
            }).catch(err => {
                this._postToWebview({ command: 'scanError', message: err.message });
                this._isRunning = false;
                this._syncConfig();
                this._postToWebview({ command: 'stopped' });
            });
        }).catch(err => {
            this._postToWebview({ command: 'scanError', message: 'ConfigServer failed: ' + err.message });
            this._isRunning = false;
            this._postToWebview({ command: 'stopped' });
        });
    }

    /**
     * macOS-specific injection: uses VS Code API (no Accessibility permissions needed).
     * 1. Open DevTools via vscode.commands
     * 2. Copy script to clipboard via vscode.env.clipboard
     * 3. Show notification asking user to press ⌘V + Enter (one-time, 2 keystrokes)
     * 4. Poll for signal file confirmation
     * 5. Auto-close DevTools
     */
    private async _injectViaMacOS(script: string): Promise<boolean> {
        // Delete stale signal file
        const cfgPath = path.join(os.tmpdir(), 'agy-config.json');
        try { fs.unlinkSync(cfgPath); } catch { }

        // 1. Open DevTools (VS Code API — no OS permissions needed)
        this._postToWebview({ command: 'diagLog', text: '🔧 Opening DevTools via VS Code API...', logType: 'info' });
        await vscode.commands.executeCommand('workbench.action.toggleDevTools');
        await this._sleep(2500);

        // 2. Copy script to clipboard (VS Code API — no OS permissions needed)
        await vscode.env.clipboard.writeText(script);
        this._postToWebview({ command: 'diagLog', text: '📋 Script copied to clipboard', logType: 'info' });

        // 3. Show instructions to user (one-time, 2 keystrokes)
        this._postToWebview({
            command: 'diagLog',
            text: '⌨️ In DevTools Console: press ⌘V then Enter (one-time setup)',
            logType: 'warning'
        });
        vscode.window.showInformationMessage(
            'AlwaysRun: Script is on your clipboard. In the DevTools Console, press ⌘V then Enter.',
            'OK'
        );

        // 4. Poll for injection confirmation (max 60s — user needs time to paste)
        const confirmed = await this._pollForSignal(cfgPath, 60);

        // 5. Close DevTools automatically
        if (confirmed) {
            await vscode.commands.executeCommand('workbench.action.toggleDevTools');
            this._postToWebview({ command: 'diagLog', text: '✅ Injection confirmed — DevTools closed', logType: 'success' });
        }

        return confirmed;
    }

    private _pollForSignal(cfgPath: string, maxSeconds: number): Promise<boolean> {
        return new Promise(resolve => {
            let elapsed = 0;
            const interval = setInterval(() => {
                if (fs.existsSync(cfgPath)) {
                    clearInterval(interval);
                    resolve(true);
                    return;
                }
                elapsed += 0.5;
                if (elapsed >= maxSeconds) {
                    clearInterval(interval);
                    resolve(false);
                }
            }, 500);
        });
    }

    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Manual Start: starts ConfigServer + sets running state but skips auto-injection.
     * Generates the inject script and sends it to the Manual Setup panel code block.
     * Polls for signal file to auto-confirm when user manually pastes.
     */
    public _manualStart() {
        if (this._isRunning && this._scriptInjected) {
            this._postToWebview({ command: 'diagLog', text: '⚠️ Already running with script injected', logType: 'warning' });
            return;
        }

        this._isRunning = true;
        this._syncConfig();
        this._postToWebview({ command: 'started' });
        this._postToWebview({ command: 'diagLog', text: '▶️ Manual Start — server starting, waiting for manual injection...', logType: 'info' });

        const matchers: string[] = [];
        if (this._toggles.yes) { matchers.push('yes'); }
        if (this._toggles.run) { matchers.push('run'); }
        if (this._toggles.retry) { matchers.push('retry'); }
        if (this._toggles.accept) { matchers.push('accept'); }
        if (this._toggles.allow) { matchers.push('allow this conversation'); }
        const liveCfg = {
            active: true,
            matchers,
            excludes: DEFAULT_EXCLUDES,
            intervalMs: this._scanIntervalMs
        };

        this._configServer.update(liveCfg);
        this._configServer.onClicked((data: any) => {
            this._postToWebview({
                command: 'scanResult',
                clicked: 1,
                found: [{ text: data.text || '?', source: data.source || 'unknown' }]
            });
        });

        this._configServer.start().then(port => {
            const script = this._buildInjectScript(port, liveCfg);
            // Send script to Manual Setup code block
            this._postToWebview({ command: 'manualScript', script });
            this._postToWebview({ command: 'diagLog', text: '📋 Script ready — copy from Manual Setup panel and paste into DevTools Console', logType: 'info' });
            this._postToWebview({ command: 'diagLog', text: '🔌 Config server on port ' + port, logType: 'info' });

            // Delete stale signal file and poll for manual injection confirmation
            const cfgPath = path.join(os.tmpdir(), 'agy-config.json');
            try { fs.unlinkSync(cfgPath); } catch { }
            this._pollForSignal(cfgPath, 120).then(confirmed => {
                if (confirmed) {
                    this._scriptInjected = true;
                    this._postToWebview({ command: 'diagLog', text: '✅ Injection confirmed! Auto-clicking active.', logType: 'success' });
                    // Auto-close DevTools
                    vscode.commands.executeCommand('workbench.action.toggleDevTools');
                }
            });
        }).catch(err => {
            this._postToWebview({ command: 'scanError', message: 'ConfigServer failed: ' + err.message });
            this._isRunning = false;
            this._postToWebview({ command: 'stopped' });
        });
    }

    public stopAutoScan() {
        this._isRunning = false;
        this._syncConfig();   // write active=false — script pauses within 1s
        this._postToWebview({ command: 'stopped' });
        this._postToWebview({ command: 'diagLog', text: '⏹ Stopped (script pauses within 1s, no DevTools needed)', logType: 'info' });
    }

    private _restartScanTimer() { /* script detects interval change via config file */ }

    /**
     * Post a message to the webview panel.
     */
    private _postToWebview(message: any) {
        this._view?.webview.postMessage(message);
    }

    // ==================== HTML ====================

    private _getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.css')
        );
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'panel.js')
        );

        const nonce = getNonce();
        const isVi = vscode.env.language.startsWith('vi');

        return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
    <link href="${styleUri}" rel="stylesheet">
    <title>Always Run</title>
</head>
<body>
    <div class="panel-container">
        <!-- Header -->
        <div class="panel-header">
            <span class="panel-icon">🎯</span>
            <span class="panel-title">Antigravity Always Run</span>
            <span class="project-badge" id="project-badge"></span>
            <span class="status-dot" id="status-dot"></span>
        </div>

        <!-- Warning -->
        <div class="warning-banner" id="warning-banner">
            <div class="warning-header" id="warning-toggle">
                <span>${isVi ? '⚠️ Cảnh báo quan trọng' : '⚠️ Important Warning'}</span>
                <span class="warning-chevron" id="warning-chevron">▾</span>
            </div>
            <div class="warning-body" id="warning-body">
                <p>${isVi
                ? 'Bạn <strong>hoàn toàn chịu trách nhiệm</strong> khi để agent chạy tự động. Hãy ý thức các rủi ro:'
                : 'You are <strong>fully responsible</strong> when running the agent autonomously. Be aware of the risks:'}</p>
                <ul>
                    <li>${isVi ? '🔥 Project có thể bị phá hủy hoặc sửa đổi ngoài ý muốn' : '🔥 Your project may be destroyed or modified unexpectedly'}</li>
                    <li>${isVi ? '💾 Các ổ đĩa hoặc project khác trên máy có thể bị can thiệp không kiểm soát' : '💾 Other drives or projects on your machine may be affected without control'}</li>
                    <li>${isVi ? '💸 Quota sử dụng Antigravity models sẽ bị tiêu tốn rất nhanh' : '💸 Antigravity model quota will be consumed very quickly'}</li>
                </ul>
                <p class="warning-tip">${isVi
                ? '💡 Khuyến nghị: sử dụng gói <strong>Google AI Ultra</strong> để tránh hết quota. <a href="#" class="ext-link" data-url="https://gamikey.com/nang-cap-google-ai-tro-ly-thong-minh-member-slot/?ref=theaux">Mua giá chiết khấu tại đây</a>. Hãy thiết lập <strong>rules</strong> cho agent hợp lý trước khi bật auto.'
                : '💡 Recommended: use <strong>Google AI Ultra</strong> plan to avoid running out of quota. <a href="#" class="ext-link" data-url="https://gamikey.com/nang-cap-google-ai-tro-ly-thong-minh-member-slot/?ref=theaux">Get it at a discount here</a>. Set up proper <strong>rules</strong> for the agent before enabling auto mode.'}</p>
            </div>
        </div>

        <!-- Manual Setup -->
        <div class="setup-banner" id="setup-banner">
            <div class="setup-header" id="setup-toggle">
                <span>🔧 Manual Setup (if auto-inject fails)</span>
                <span class="warning-chevron collapsed" id="setup-chevron">▾</span>
            </div>
            <div class="setup-body hidden" id="setup-body">
                <div class="setup-step">
                    <span class="step-num">1</span>
                    <span class="step-text">Start the config server:<br>
                        <button class="setup-open-btn" id="manual-start-btn">▶️ Manual Start</button>
                    </span>
                </div>
                <div class="setup-step">
                    <span class="step-num">2</span>
                    <span class="step-text">Open DevTools Console:<br>
                        <button class="setup-open-btn" id="setup-open-devtools">🔧 Open DevTools</button>
                    </span>
                </div>
                <div class="setup-step">
                    <span class="step-num">3</span>
                    <span class="step-text">Click the <strong>Console</strong> tab in DevTools.</span>
                </div>
                <div class="setup-step">
                    <span class="step-num">4</span>
                    <span class="step-text">Copy the script below:</span>
                </div>
                <div class="setup-code-wrap">
                    <pre class="setup-code" id="setup-script-code">Click "Manual Start" first to generate the script.</pre>
                    <button class="setup-copy-btn" id="setup-copy-btn">📋 Copy</button>
                </div>
                <div class="setup-step">
                    <span class="step-num">5</span>
                    <span class="step-text">Paste into Console:<br>
                        <strong>Windows/Linux:</strong> <kbd>Ctrl</kbd>+<kbd>V</kbd> &nbsp;
                        <strong>macOS:</strong> <kbd>⌘</kbd>+<kbd>V</kbd><br>
                        Or <em>right-click → Paste</em>
                    </span>
                </div>
                <div class="setup-step">
                    <span class="step-num">6</span>
                    <span class="step-text">If you see <em>"type allow pasting"</em> warning, type <kbd>allow pasting</kbd>, press <kbd>Enter</kbd>, then paste again.</span>
                </div>
                <div class="setup-step">
                    <span class="step-num">7</span>
                    <span class="step-text">Press <kbd>Enter</kbd> to run. You should see <code>[AlwaysRun] Injected.</code> in the console. DevTools will close automatically.</span>
                </div>
            </div>
        </div>

        <!-- Status -->
        <div class="status-section">
            <div class="status-row">
                <span class="status-label">Status</span>
                <span class="status-value" id="status-text">Idle</span>
            </div>
            <div class="status-row">
                <span class="status-label">Clicked</span>
                <span class="status-value">
                    <span id="click-count" class="highlight">0</span> times
                </span>
            </div>
        </div>

        <hr class="divider">

        <!-- Button Toggles -->
        <div class="toggles-section">
            <div class="toggles-header">Auto-click buttons</div>
            <div class="toggle-row">
                <span class="toggle-label">✅ Yes</span>
                <span class="toggle-count" id="count-yes">0</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-yes" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">▶️ Run</span>
                <span class="toggle-count" id="count-run">0</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-run" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">🔄 Retry</span>
                <span class="toggle-count" id="count-retry">0</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-retry" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">☑️ Accept</span>
                <span class="toggle-count" id="count-accept">0</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-accept" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">🔓 Allow</span>
                <span class="toggle-count" id="count-allow">0</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-allow" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
        </div>

        <hr class="divider">

        <!-- Auto-scroll toggle -->
        <div class="toggles-section">
            <div class="toggle-row">
                <span class="toggle-label">📜 Auto-scroll</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-scroll" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="scroll-warning hidden" id="scroll-warning">
                ⚠️ Auto-scroll is disabled. Buttons outside the viewport may not be detected. You must manually scroll to the bottom of the chat for auto-click to work.
            </div>
        </div>

        <hr class="divider">

        <!-- Scan Interval -->
        <div class="interval-section">
            <div class="interval-label">Scan interval (seconds)</div>
            <div class="interval-input-wrap">
                <button class="interval-btn" id="interval-down">◀</button>
                <input type="number" id="interval-input" class="interval-input" value="3" min="0.5" max="10000" step="0.5">
                <button class="interval-btn" id="interval-up">▶</button>
            </div>
        </div>

        <!-- Scan Info -->
        <div class="scan-info" id="scan-info">
            Scanning every 3 seconds
        </div>

        <!-- Toggle Button -->
        <div class="button-group">
            <button class="btn btn-primary" id="toggle-btn">
                <span class="btn-icon">▶️</span> Start Auto
            </button>
        </div>

        <!-- Log -->
        <div class="log-section">
            <div class="log-header">
                <span>Activity Log</span>
                <div style="display:flex;gap:4px">
                    <button class="btn-clear" id="clear-log-btn">Clear</button>
                </div>
            </div>
            <div class="log-container" id="log-container">
                <div class="log-entry log-info">Ready. Click "Start Auto" to begin.</div>
            </div>
        </div>
    </div>

    <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
    }
}

function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
