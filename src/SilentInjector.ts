/**
 * Silent Script Injection Engine
 * 
 * Uses only VS Code / Antigravity internal commands to inject the
 * auto-click script — NO PowerShell, NO osascript, NO keyboard simulation.
 * 
 * Strategy 1 (CDP): Scan ports for CDP endpoints, inject via Runtime.evaluate
 * Strategy 2 (DevTools paste): Open DevTools, clipboard + paste, verify via /signal
 */

import * as vscode from 'vscode';
import * as http from 'http';

/** Interface for signal verification — matches ConfigServer */
interface SignalChecker {
    readonly hasScriptSignal: boolean;
}

export class SilentInjector {

    /**
     * Try to inject script silently using only VS Code APIs.
     * @param signalUrl - URL to check for injection confirmation (configServer /signal)
     */
    async inject(script: string, logFn?: (msg: string) => void, signalChecker?: SignalChecker): Promise<boolean> {
        const log = logFn || ((msg: string) => console.log(`[SilentInjector] ${msg}`));

        // Strategy 1: Try CDP WebSocket injection (truly silent, no DevTools window)
        log('🔍 Trying CDP injection...');
        const cdpSuccess = await this._tryCDPInjection(script, log);
        if (cdpSuccess) {
            log('✅ Script injected via CDP — no DevTools needed!');
            return true;
        }

        // Strategy 2: Open DevTools via command, paste from clipboard, execute
        log('🔧 CDP not available, trying DevTools paste method...');
        const devtoolsSuccess = await this._tryDevToolsPaste(script, log, signalChecker);
        if (devtoolsSuccess) {
            log('✅ Script injected via DevTools paste!');
            return true;
        }

        log('⚠️ Silent injection failed — falling back to native handler');
        return false;
    }

    /**
     * Strategy 1: Scan ports for CDP, inject via WebSocket Runtime.evaluate
     */
    private async _tryCDPInjection(script: string, log: (msg: string) => void): Promise<boolean> {
        try {
            // Collect candidate ports from Antigravity commands
            const portsToTry: number[] = [];

            try {
                const cdpUrl = await vscode.commands.executeCommand<string>('antigravity.getChromeDevtoolsMcpUrl');
                if (cdpUrl) {
                    log(`  MCP URL: ${cdpUrl}`);
                    const p = this._extractPort(cdpUrl);
                    if (p) { portsToTry.push(p); }
                }
            } catch {}

            try {
                const browserPort = await vscode.commands.executeCommand<number>('antigravity.getBrowserOnboardingPort');
                if (browserPort) {
                    log(`  Browser port: ${browserPort}`);
                    portsToTry.push(browserPort);
                }
            } catch {}

            // Also scan common CDP ports (like antigravity-plus does)
            portsToTry.push(9222, 9229, 9000, 9001, 9002, 9003);

            // Deduplicate
            const uniquePorts = [...new Set(portsToTry)];
            log(`  Scanning ${uniquePorts.length} ports for CDP targets...`);

            for (const port of uniquePorts) {
                try {
                    const targets = await this._getTargets(port);
                    // Verify it's a valid CDP response (must be an array)
                    if (!Array.isArray(targets) || targets.length === 0) {
                        continue;
                    }

                    log(`  Port ${port}: found ${targets.length} target(s)`);

                    // Find the main page target
                    const pageTarget = targets.find((t: any) => t.type === 'page') || targets[0];
                    if (!pageTarget?.webSocketDebuggerUrl) {
                        log(`  Port ${port}: no WebSocket debugger URL`);
                        continue;
                    }

                    log(`  Connecting to: ${pageTarget.webSocketDebuggerUrl}`);
                    const success = await this._injectViaCDP(pageTarget.webSocketDebuggerUrl, script, log);
                    if (success) { return true; }
                } catch {
                    // Port didn't respond or isn't CDP — skip
                }
            }

            log('  No working CDP target found on any port');
            return false;
        } catch (e: any) {
            log(`  CDP injection error: ${e.message || e}`);
            return false;
        }
    }

    /**
     * Strategy 2: Open DevTools, paste script from clipboard, execute
     * Verifies injection by waiting for the /signal POST from the injected script
     */
    private async _tryDevToolsPaste(script: string, log: (msg: string) => void, signalChecker?: SignalChecker): Promise<boolean> {
        try {
            // 1. Save current clipboard content
            const savedClipboard = await vscode.env.clipboard.readText();

            // 2. Copy inject script to clipboard
            await vscode.env.clipboard.writeText(script);
            log('  📋 Script copied to clipboard');

            // 3. Open DevTools
            await vscode.commands.executeCommand('workbench.action.toggleDevTools');
            log('  🔧 DevTools opened — waiting for console focus...');

            // 4. Wait for DevTools to fully load and console to be ready
            await this._sleep(3000);

            // 5. Try paste via VS Code command (may or may not work in DevTools context)
            let pasteWorked = false;
            try {
                await vscode.commands.executeCommand('editor.action.clipboardPasteAction');
                await this._sleep(300);
                pasteWorked = true;
                log('  📋 Paste command executed');
            } catch {
                log('  ⚠️ Paste command not available in DevTools context');
            }

            if (!pasteWorked) {
                // Show notification asking user to paste manually
                log('  💡 Please press Ctrl+V then Enter in the DevTools console');
                vscode.window.showInformationMessage(
                    'AlwaysRun: Script copied! Press Ctrl+V then Enter in DevTools console.',
                    'Got it'
                );
                // Wait extra time for manual paste
                await this._sleep(8000);
            }

            // 6. Verify injection via ConfigServer signal (injected script POSTs to /signal)
            let injectionVerified = false;
            if (signalChecker) {
                log('  ⏳ Waiting for injection signal from script...');
                for (let i = 0; i < 15; i++) {
                    await this._sleep(500);
                    if (signalChecker.hasScriptSignal) {
                        injectionVerified = true;
                        log('  ✅ Injection verified — script is running!');
                        break;
                    }
                }
                if (!injectionVerified) {
                    log('  ❌ Injection NOT verified — script did not send /signal');
                }
            }

            // 7. Restore original clipboard
            if (savedClipboard) {
                await vscode.env.clipboard.writeText(savedClipboard);
            }

            // 8. Close DevTools
            await this._sleep(500);
            await vscode.commands.executeCommand('workbench.action.toggleDevTools');
            log('  🔧 DevTools closed');

            // If we have a signal checker, only return true if verified
            if (signalChecker) {
                return injectionVerified;
            }

            // Without signal URL, we can't verify — return true optimistically
            return true;
        } catch (e: any) {
            log(`  DevTools paste error: ${e.message || e}`);
            // Try to close DevTools if open
            try { await vscode.commands.executeCommand('workbench.action.toggleDevTools'); } catch {}
            return false;
        }
    }

    /**
     * Inject script via CDP WebSocket Runtime.evaluate
     */
    private _injectViaCDP(wsUrl: string, script: string, log: (msg: string) => void): Promise<boolean> {
        return new Promise((resolve) => {
            try {
                const WebSocket = require('ws');
                const ws = new WebSocket(wsUrl);
                let resolved = false;

                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        try { ws.close(); } catch {}
                        log('  CDP connection timed out');
                        resolve(false);
                    }
                }, 10000);

                ws.on('open', () => {
                    log('  🔌 CDP WebSocket connected');
                    ws.send(JSON.stringify({
                        id: 1,
                        method: 'Runtime.evaluate',
                        params: { expression: script, returnByValue: true }
                    }));
                });

                ws.on('message', (data: any) => {
                    try {
                        const response = JSON.parse(data.toString());
                        if (response.id === 1) {
                            resolved = true;
                            clearTimeout(timeout);
                            ws.close();
                            if (response.result && !response.result.exceptionDetails) {
                                log('  ✅ Runtime.evaluate succeeded');
                                resolve(true);
                            } else {
                                const err = response.result?.exceptionDetails?.text || 'Execution error';
                                log(`  ❌ Runtime.evaluate failed: ${err}`);
                                resolve(false);
                            }
                        }
                    } catch {}
                });

                ws.on('error', (err: any) => {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        resolve(false);
                    }
                });
            } catch (e: any) {
                log(`  WebSocket setup error: ${e.message}`);
                resolve(false);
            }
        });
    }

    /**
     * Get CDP targets from /json/list endpoint
     */
    private _getTargets(port: number): Promise<any[]> {
        return new Promise((resolve) => {
            const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
                let data = '';
                res.on('data', (chunk: string) => data += chunk);
                res.on('end', () => {
                    try {
                        const parsed = JSON.parse(data);
                        resolve(Array.isArray(parsed) ? parsed : []);
                    } catch {
                        resolve([]);
                    }
                });
            });
            req.on('error', () => resolve([]));
            req.setTimeout(2000, () => { req.destroy(); resolve([]); });
        });
    }

    private _httpGet(url: string): Promise<boolean> {
        return new Promise((resolve) => {
            const req = http.get(url, (res) => {
                resolve(res.statusCode === 200);
                res.resume();
            });
            req.on('error', () => resolve(false));
            req.setTimeout(1000, () => { req.destroy(); resolve(false); });
        });
    }

    private _extractPort(url: string): number | null {
        try {
            const match = url.match(/:(\d+)/);
            return match ? parseInt(match[1], 10) : null;
        } catch {
            return null;
        }
    }

    private _sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
