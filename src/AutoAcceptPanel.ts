import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class AutoAcceptPanelProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'antigravity-always-run.panel';

    private _view?: vscode.WebviewView;
    private _isRunning = false;

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
                case 'inject':
                    this.injectScript();
                    break;
                case 'stop':
                    this.stopAutoClick();
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
        this._isRunning = !this._isRunning;
        this._view?.webview.postMessage({
            command: 'toggleAutoClick',
            isRunning: this._isRunning
        });
    }

    public stopAutoClick() {
        this._isRunning = false;
        this._view?.webview.postMessage({ command: 'stop' });
    }

    public async injectScript() {
        // Read the original agy-auto-accept.js script
        const scriptPath = path.join(this._extensionUri.fsPath, 'agy-auto-accept.js');
        
        try {
            const scriptContent = fs.readFileSync(scriptPath, 'utf-8');
            
            // Copy to clipboard for easy pasting into DevTools
            await vscode.env.clipboard.writeText(scriptContent);
            vscode.window.showInformationMessage(
                '📋 Auto-accept script copied to clipboard! Paste into DevTools console (F12) to activate.',
                'Open DevTools'
            ).then(choice => {
                if (choice === 'Open DevTools') {
                    vscode.commands.executeCommand('workbench.action.toggleDevTools');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to read script: ${error}`);
        }
    }

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
                <div class="log-entry log-info">Ready. Click "Inject Script" to start.</div>
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
