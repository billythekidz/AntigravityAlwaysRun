import * as vscode from 'vscode';

export class AutoAcceptPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'antigravity-always-run.panel';

    private _view?: vscode.WebviewView;
    private _isRunning = false;
    private _scanTimer: ReturnType<typeof setInterval> | null = null;
    private _scanIntervalMs = 3000; // default 3s

    // Toggle states for which buttons to auto-click
    private _toggles = {
        yes: true,
        run: true,
        retry: true
    };

    constructor(private readonly _extensionUri: vscode.Uri) {}

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
                    console.log('[Always Run] Toggles updated:', this._toggles);
                    break;
                case 'intervalChange':
                    this._scanIntervalMs = Math.max(500, Math.min(10000000, message.intervalMs));
                    console.log(`[Always Run] Scan interval: ${this._scanIntervalMs}ms`);
                    // Restart scanning with new interval if running
                    if (this._isRunning) {
                        this._restartScanTimer();
                    }
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
            }
        });
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

    // ==================== CORE: Electron-based DOM injection ====================

    /**
     * Execute JavaScript in VS Code's main renderer window via Electron API.
     * This bypasses the webview sandbox and runs in the actual editor DOM.
     */
    private async _executeInMainWindow(js: string): Promise<any> {
        try {
            // Access Electron's BrowserWindow from the Node.js context
            const electron = require('electron');
            const windows = electron.BrowserWindow.getAllWindows();
            
            if (windows.length === 0) {
                console.error('[Always Run] No Electron windows found');
                return null;
            }

            // Use the first window (the main VS Code window)
            const mainWindow = windows[0];
            const result = await mainWindow.webContents.executeJavaScript(js, true);
            return result;
        } catch (error: any) {
            console.error('[Always Run] executeJavaScript failed:', error.message);
            return null;
        }
    }

    /**
     * Build the inline scanner script based on current toggle states.
     * This script runs in VS Code's main renderer process DOM.
     */
    private _buildScannerScript(): string {
        const matchers: string[] = [];
        if (this._toggles.yes) { matchers.push(`'yes'`); }
        if (this._toggles.run) { matchers.push(`'run'`); }
        if (this._toggles.retry) { matchers.push(`'retry'`); }

        // If no toggles are on, don't scan
        if (matchers.length === 0) {
            return `(function() { return JSON.stringify({ clicked: 0, found: [], scanned: 0 }); })()`;
        }

        // The scanner script that runs inside VS Code's Electron renderer
        return `(function() {
            var matchers = [${matchers.join(',')}];
            var foundButtons = [];
            var clicked = 0;
            var scannedFrames = 0;

            function scanDoc(doc, label) {
                try {
                    var buttons = doc.querySelectorAll('button, [role="button"], a.monaco-button');
                    for (var i = 0; i < buttons.length; i++) {
                        var btn = buttons[i];
                        var text = (btn.textContent || '').trim().toLowerCase();
                        var ariaLabel = (btn.getAttribute('aria-label') || '').toLowerCase();
                        var title = (btn.getAttribute('title') || '').toLowerCase();
                        var allText = text + ' ' + ariaLabel + ' ' + title;

                        // Check if button matches any enabled matcher
                        var isTarget = false;
                        for (var m = 0; m < matchers.length; m++) {
                            if (allText.indexOf(matchers[m]) !== -1) {
                                isTarget = true;
                                break;
                            }
                        }

                        // Exclude "Always Run" button (ourselves!)
                        var isExcluded = allText.indexOf('always run') !== -1 
                            || allText.indexOf('always allow') !== -1
                            || allText.indexOf('always deny') !== -1;

                        // Must be visible, enabled, and not already clicked
                        if (isTarget && !isExcluded 
                            && btn.offsetWidth > 0 && btn.offsetHeight > 0 
                            && !btn.disabled
                            && !btn.dataset.agyClicked) {
                            foundButtons.push({
                                text: (text || ariaLabel || title).substring(0, 40),
                                source: label
                            });
                            btn.click();
                            btn.dataset.agyClicked = '1';
                            // Clear the marker after 5 seconds so it can be clicked again
                            setTimeout(function() { try { delete btn.dataset.agyClicked; } catch(e) {} }, 5000);
                            clicked++;
                        }
                    }
                } catch(e) { /* Cannot access document */ }
            }

            // 1. Scan main document
            scanDoc(document, 'main');

            // 2. Scan all iframes (agent panels, webviews rendered as iframes)
            var iframes = document.querySelectorAll('iframe');
            for (var i = 0; i < iframes.length; i++) {
                scannedFrames++;
                try {
                    var iframeDoc = iframes[i].contentDocument || iframes[i].contentWindow.document;
                    if (iframeDoc) { scanDoc(iframeDoc, 'iframe-' + i); }
                } catch(e) { /* cross-origin iframe */ }
            }

            // 3. Scan shadow DOMs (VS Code uses them extensively)
            function scanShadowRoots(root, depth) {
                if (depth > 5) return; // prevent infinite recursion
                try {
                    var elements = root.querySelectorAll('*');
                    for (var j = 0; j < elements.length; j++) {
                        if (elements[j].shadowRoot) {
                            scannedFrames++;
                            scanDoc(elements[j].shadowRoot, 'shadow-' + depth);
                            scanShadowRoots(elements[j].shadowRoot, depth + 1);
                        }
                    }
                } catch(e) {}
            }
            scanShadowRoots(document, 0);

            // 4. Scan webview elements (Electron-specific)
            var webviews = document.querySelectorAll('webview');
            for (var w = 0; w < webviews.length; w++) {
                scannedFrames++;
                try {
                    var wvDoc = webviews[w].contentDocument;
                    if (wvDoc) { scanDoc(wvDoc, 'webview-' + w); }
                } catch(e) { /* Cannot access webview */ }
            }

            return JSON.stringify({
                clicked: clicked,
                found: foundButtons,
                scanned: scannedFrames
            });
        })()`;
    }

    /**
     * Start the periodic auto-scan loop.
     */
    public startAutoScan() {
        if (this._isRunning) { return; }
        this._isRunning = true;

        console.log(`[Always Run] Auto-scan STARTED (interval: ${this._scanIntervalMs}ms)`);
        this._postToWebview({ command: 'started' });

        // Run immediately
        this._runScanCycle();

        // Then at configured interval
        this._scanTimer = setInterval(() => {
            this._runScanCycle();
        }, this._scanIntervalMs);
    }

    /**
     * Restart the scan timer with the current interval (used when interval changes mid-scan).
     */
    private _restartScanTimer() {
        if (this._scanTimer) {
            clearInterval(this._scanTimer);
        }
        this._scanTimer = setInterval(() => {
            this._runScanCycle();
        }, this._scanIntervalMs);
    }

    /**
     * Stop the periodic auto-scan loop.
     */
    public stopAutoScan() {
        if (this._scanTimer) {
            clearInterval(this._scanTimer);
            this._scanTimer = null;
        }
        this._isRunning = false;
        console.log('[Always Run] Auto-scan STOPPED');
        this._postToWebview({ command: 'stopped' });
    }

    /**
     * Run one scan cycle: execute the scanner in the main window and report results.
     */
    private async _runScanCycle() {
        if (!this._isRunning) { return; }

        try {
            const script = this._buildScannerScript();
            const resultStr = await this._executeInMainWindow(script);

            if (resultStr) {
                const result = JSON.parse(resultStr);
                
                // Send results to the webview panel
                this._postToWebview({
                    command: 'scanResult',
                    clicked: result.clicked,
                    found: result.found,
                    scanned: result.scanned
                });

                if (result.clicked > 0) {
                    console.log(`[Always Run] Clicked ${result.clicked} button(s):`, 
                        result.found.map((b: any) => b.text).join(', '));
                }
            }
        } catch (error: any) {
            console.error('[Always Run] Scan cycle error:', error.message);
        }
    }

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
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-yes" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">▶️ Run</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-run" checked>
                    <span class="toggle-slider"></span>
                </label>
            </div>
            <div class="toggle-row">
                <span class="toggle-label">🔄 Retry</span>
                <label class="toggle-switch">
                    <input type="checkbox" id="toggle-retry" checked>
                    <span class="toggle-slider"></span>
                </label>
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
                <button class="btn-clear" id="clear-log-btn">Clear</button>
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
