import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

interface CDPPage {
    id: string;
    type: string;
    url: string;
    title: string;
    webSocketDebuggerUrl: string;
}

interface CDPConnection {
    ws: any;
    injected: boolean;
}

export class CdpHandler {
    private connections = new Map<string, CDPConnection>();
    private msgId = 1;
    private WS: any;
    private scriptCache: string | null = null;

    basePort = 9222;
    portRange = 3;

    constructor(
        private log: (msg: string, type?: string) => void,
        private extensionPath: string
    ) {
        try {
            this.WS = require('ws');
        } catch (e: any) {
            this.log('❌ ws package not found: ' + e.message, 'error');
        }
    }

    // ── Script loading ──────────────────────────────────────────────────────────

    private getScript(): string {
        if (this.scriptCache) { return this.scriptCache; }
        const candidates = [
            path.join(this.extensionPath, 'media', 'auto-accept.js'),
            path.join(__dirname, '..', 'media', 'auto-accept.js'),
        ];
        for (const p of candidates) {
            if (fs.existsSync(p)) {
                this.scriptCache = fs.readFileSync(p, 'utf-8');
                this.log(`📄 auto-accept.js loaded (${(this.scriptCache.length / 1024).toFixed(1)} KB)`);
                return this.scriptCache;
            }
        }
        throw new Error('auto-accept.js not found: ' + candidates.join(', '));
    }

    // ── Port scanning ───────────────────────────────────────────────────────────

    private portCandidates(): number[] {
        const ports: number[] = [];
        for (let p = this.basePort - this.portRange; p <= this.basePort + this.portRange; p++) {
            if (p > 0 && p < 65535) { ports.push(p); }
        }
        return ports;
    }

    private getPages(port: number): Promise<(CDPPage & { _port: number })[]> {
        return new Promise((resolve) => {
            const req = http.get(
                { hostname: '127.0.0.1', port, path: '/json/list', timeout: 800 },
                (res) => {
                    let body = '';
                    res.on('data', (c) => body += c);
                    res.on('end', () => {
                        try {
                            const pages: CDPPage[] = JSON.parse(body);
                            resolve(
                                pages
                                    .filter(p => {
                                        if (!p.webSocketDebuggerUrl) { return false; }
                                        if (p.type !== 'page' && p.type !== 'webview') { return false; }
                                        const url = (p.url || '').toLowerCase();
                                        return !url.startsWith('devtools://') && !url.startsWith('chrome-devtools://');
                                    })
                                    .map(p => ({ ...p, _port: port }))
                            );
                        } catch { resolve([]); }
                    });
                }
            );
            req.on('error', () => resolve([]));
            req.on('timeout', () => { (req as any).destroy(); resolve([]); });
        });
    }

    // ── WebSocket connection ────────────────────────────────────────────────────

    private connectTo(connId: string, wsUrl: string): Promise<boolean> {
        return new Promise((resolve) => {
            if (!this.WS) { resolve(false); return; }
            const ws = new this.WS(wsUrl);
            const timer = setTimeout(() => { try { ws.terminate(); } catch {} resolve(false); }, 3000);

            ws.on('open', () => {
                clearTimeout(timer);
                this.connections.set(connId, { ws, injected: false });
                this.log(`🔗 Connected: ${connId}`);
                resolve(true);
            });
            ws.on('error', () => { clearTimeout(timer); resolve(false); });
            ws.on('close', () => {
                this.connections.delete(connId);
                this.log(`🔌 Disconnected: ${connId}`);
            });
        });
    }

    private evaluate(connId: string, expression: string): Promise<any> {
        const conn = this.connections.get(connId);
        if (!conn || conn.ws.readyState !== 1 /* OPEN */) {
            return Promise.reject(new Error('Not connected'));
        }
        return new Promise((resolve, reject) => {
            const id = this.msgId++;
            const timer = setTimeout(() => {
                conn.ws.off('message', handler);
                reject(new Error('CDP timeout'));
            }, 5000);

            const handler = (data: any) => {
                try {
                    const msg = JSON.parse(data.toString());
                    if (msg.id === id) {
                        conn.ws.off('message', handler);
                        clearTimeout(timer);
                        resolve(msg.result);
                    }
                } catch {}
            };
            conn.ws.on('message', handler);
            conn.ws.send(JSON.stringify({
                id,
                method: 'Runtime.evaluate',
                params: { expression, userGesture: true, awaitPromise: true }
            }));
        });
    }

    // ── Public API ──────────────────────────────────────────────────────────────

    /**
     * One scan cycle: find available CDP pages, connect, inject, start script.
     * Returns the window title of the first connected page.
     */
    async runCycle(): Promise<{ connectedCount: number; windowTitle: string }> {
        if (!this.WS) { return { connectedCount: 0, windowTitle: '' }; }

        let windowTitle = '';

        for (const port of this.portCandidates()) {
            let pages: (CDPPage & { _port: number })[];
            try { pages = await this.getPages(port); } catch { continue; }
            if (pages.length === 0) { continue; }

            for (const page of pages) {
                const connId = `${port}:${page.id}`;

                // Connect if not connected
                if (!this.connections.has(connId)) {
                    await this.connectTo(connId, page.webSocketDebuggerUrl);
                }
                if (!this.connections.has(connId)) { continue; }
                const conn = this.connections.get(connId)!;

                // Check if script is still alive (webviews can reload)
                if (conn.injected) {
                    try {
                        const res = await this.evaluate(connId, 'typeof window.__autoAcceptStart === "function"');
                        if (!res?.result?.value) { conn.injected = false; }
                    } catch { conn.injected = false; }
                }

                // Inject if needed
                if (!conn.injected) {
                    try {
                        await this.evaluate(connId, this.getScript());
                        conn.injected = true;
                        this.log(`💉 Injected into ${connId} — ${page.title || page.url}`);
                    } catch (e: any) {
                        this.log(`❌ Inject failed ${connId}: ${e.message}`, 'error');
                        continue;
                    }
                }

                // Ensure it's running
                try {
                    const cfg = JSON.stringify({ ide: 'antigravity', isBackgroundMode: false });
                    await this.evaluate(connId, `if(window.__autoAcceptStart) window.__autoAcceptStart(${cfg})`);
                } catch {}

                // Grab title for project badge
                if (!windowTitle) {
                    try {
                        const r = await this.evaluate(connId, 'document.title');
                        windowTitle = r?.result?.value || page.title || '';
                    } catch {}
                }
            }
        }

        return { connectedCount: this.connections.size, windowTitle };
    }

    async stop(): Promise<void> {
        for (const [connId, conn] of this.connections) {
            try {
                await this.evaluate(connId, 'if(window.__autoAcceptStop) window.__autoAcceptStop()');
                conn.ws.close();
            } catch {}
        }
        this.connections.clear();
        this.log('🛑 All CDP connections closed');
    }

    get connectionCount(): number { return this.connections.size; }
}
