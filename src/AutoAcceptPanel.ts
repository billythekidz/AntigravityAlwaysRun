import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { NativeClickHandler } from './NativeClickHandler';

// ==================== PROJECT DETECTION ====================

interface ProjectProfile {
    id: string;
    label: string;
    emoji: string;
    description: string;
    defaultToggles: { yes: boolean; run: boolean; retry: boolean; };
    extraMatchers?: string[];
    excludeMatchers?: string[];
}

const PROFILES: ProjectProfile[] = [
    {
        id: 'unity',
        label: 'Unity IDE',
        emoji: '🎮',
        description: 'Antigravity Unity project',
        defaultToggles: { yes: true, run: true, retry: true },
        extraMatchers: ['accept', 'confirm', 'allow', 'apply'],
        excludeMatchers: ['always run', 'always allow', 'always deny']
    },
    {
        id: 'nakama',
        label: 'Game Server',
        emoji: '⚙️',
        description: 'Nakama server project',
        defaultToggles: { yes: true, run: true, retry: false },
        extraMatchers: ['deploy', 'apply', 'confirm'],
        excludeMatchers: ['always run', 'always allow', 'always deny']
    },
    {
        id: 'dashboard',
        label: 'Dashboard',
        emoji: '🖥',
        description: 'Next.js dashboard project',
        defaultToggles: { yes: true, run: false, retry: false },
        extraMatchers: ['confirm', 'submit'],
        excludeMatchers: ['always run', 'always allow', 'always deny']
    },
    {
        id: 'generic',
        label: 'Generic',
        emoji: '◆',
        description: 'No specific project detected',
        defaultToggles: { yes: true, run: true, retry: true },
        excludeMatchers: ['always run', 'always allow', 'always deny']
    }
];

class ProjectDetector {
    /**
     * Detect project type from a VS Code window title.
     * Window titles look like: "MyProjectName - Visual Studio Code" or
     * "MyProjectName (Workspace) - Antigravity IDE"
     */
    static detectFromTitle(windowTitle: string): ProjectProfile & { projectName: string } {
        // Extract project name: everything before the first " - " or " ("
        const projectName = windowTitle
            .replace(/ - (Visual Studio Code|Antigravity IDE|Code).*$/i, '')
            .replace(/\s*\(.*?\)\s*$/g, '')
            .trim();

        // Try to match against known project patterns via workspace folders
        const folders = vscode.workspace.workspaceFolders || [];
        for (const folder of folders) {
            const root = folder.uri.fsPath;
            const folderName = path.basename(root);

            // If the window title contains this folder name
            if (windowTitle.toLowerCase().includes(folderName.toLowerCase())) {
                return { ...ProjectDetector._detectFromPath(root), projectName: folderName };
            }
        }

        // Fallback: return generic with inferred project name from title
        return { ...PROFILES[3], projectName: projectName || 'Unknown' };
    }

    static _detectFromPath(root: string): ProjectProfile {
        const hasAssets = fs.existsSync(path.join(root, 'Assets'));
        const hasProjectSettings = fs.existsSync(path.join(root, 'ProjectSettings'));
        if (hasAssets && hasProjectSettings) { return PROFILES[0]; }

        const pkgPath = path.join(root, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
                const deps = { ...pkg.dependencies, ...pkg.devDependencies };
                if (deps['nakama-runtime'] || deps['@heroiclabs/nakama-runtime']) { return PROFILES[1]; }
            } catch {}
        }

        try {
            const files = fs.readdirSync(root);
            if (files.some(f => f.toLowerCase().startsWith('next.config'))) { return PROFILES[2]; }
        } catch {}

        return PROFILES[3];
    }

    /**
     * Detect from current workspace folders (fallback for initial load).
     */
    static async detect(): Promise<ProjectProfile & { projectName: string }> {
        const folders = vscode.workspace.workspaceFolders;
        if (!folders || folders.length === 0) {
            return { ...PROFILES[3], projectName: 'Unknown' };
        }
        const root = folders[0].uri.fsPath;
        const folderName = path.basename(root);
        return { ...ProjectDetector._detectFromPath(root), projectName: folderName };
    }
}

export class AutoAcceptPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'antigravity-always-run.panel';

    private _view?: vscode.WebviewView;
    private _isRunning = false;
    private _scanTimer: ReturnType<typeof setInterval> | null = null;
    private _scanIntervalMs = 3000; // default 3s
    private _profile: ProjectProfile = PROFILES[3]; // default: generic
    private _cdp!: NativeClickHandler;

    // Toggle states for which buttons to auto-click
    private _toggles = {
        yes: true,
        run: true,
        retry: true
    };

    constructor(private readonly _extensionUri: vscode.Uri) {
        this._cdp = new NativeClickHandler();
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

        // Detect the project and send the profile to the webview
        ProjectDetector.detect().then(profile => {
            this._profile = profile;
            this._toggles = { ...profile.defaultToggles };
            this._postToWebview({ command: 'projectProfile', profile });
        });

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
                try { log(`   Window[${i}]: "${w.getTitle()}" id=${w.id}`, 'info'); } catch {}
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

    // ==================== CORE: CDP-based DOM injection ====================

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

        // Build matcher lists from toggles + profile
        const matchers: string[] = [];
        if (this._toggles.yes)   { matchers.push('yes'); }
        if (this._toggles.run)   { matchers.push('run'); }
        if (this._toggles.retry) { matchers.push('retry'); }
        for (const extra of (this._profile.extraMatchers || [])) {
            if (!matchers.includes(extra)) { matchers.push(extra); }
        }
        const excludes = this._profile.excludeMatchers || ['always run', 'always allow', 'always deny'];

        if (matchers.length === 0) { return; }

        try {
            const result = await this._cdp.click(matchers, excludes);

            if (result.error && result.clicked === 0) {
                this._postToWebview({ command: 'scanError', message: result.error });
            } else {
                this._postToWebview({
                    command: 'scanResult',
                    clicked: result.clicked,
                    found: result.found,
                    scanned: 1
                });
                if (result.clicked > 0) {
                    console.log(`[Always Run] Clicked ${result.clicked}:`, result.found.map((b: any) => b.text).join(', '));
                }
            }
        } catch (error: any) {
            console.error('[Always Run] Scan error:', error.message);
            this._postToWebview({ command: 'scanError', message: error.message });
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
            <span class="project-badge" id="project-badge">◆ Generic</span>
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
                <div style="display:flex;gap:4px">
                    <button class="btn-clear" id="diagnose-btn" title="Test extension host Electron access">🔧 Diag</button>
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
