import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface ScanConfig {
    active: boolean;
    matchers: string[];
    excludes: string[];
    intervalMs: number;
    autoScroll?: boolean;
}

function sessionFilePath(projectName: string): string {
    const safe = projectName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase() || 'default';
    return path.join(os.tmpdir(), `agy-session-${safe}.json`);
}

/**
 * Tiny localhost HTTP server that exposes the current scan config as JSON.
 * The injected DevTools script polls this endpoint each tick — so all panel
 * settings (toggles, interval, start/stop) propagate automatically with no
 * re-injection needed after the very first Start.
 */
export class ConfigServer {
    private _server: http.Server | null = null;
    private _port = 0;
    private _startTime = 0;
    private _lastHeartbeat = 0;
    private _projectName: string;
    private _sessionFile: string;
    private _config: ScanConfig = {
        active: false,
        matchers: [],
        excludes: ['always run', 'always allow', 'always deny'],
        intervalMs: 3000
    };

    private _onSignal: (() => void) | null = null;
    private _onClicked: ((data: any) => void) | null = null;
    private _signalReceived = false;

    constructor(projectName = '') {
        this._projectName = projectName;
        this._sessionFile = sessionFilePath(projectName);
    }

    async start(): Promise<number> {
        if (this._server) { return this._port; }  // already running locally

        // Try restoring from a previous session's still-alive server
        const existing = await ConfigServer.tryRestore(this._projectName);
        if (existing) {
            console.log(`[AlwaysRun] Reusing existing ConfigServer on port ${existing.port}`);
            this._port = existing.port;
            this._startTime = Date.now();
            // Don't create a new server — the old one is still serving
            return this._port;
        }

        // No existing server — create a new one
        return new Promise((resolve, reject) => {
            this._server = http.createServer((req, res) => {
                res.setHeader('Access-Control-Allow-Origin', '*');
                res.setHeader('Cache-Control', 'no-cache, no-store');
                this._handleRequest(req, res);
            });
            this._server.listen(0, '127.0.0.1', () => {
                this._port = (this._server!.address() as any).port;
                this._startTime = Date.now();
                console.log(`[AlwaysRun] ConfigServer listening on port ${this._port}`);
                this._saveSession();
                resolve(this._port);
            });
            this._server.on('error', reject);
        });
    }

    private _handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
        // POST /signal — injected script calls this to confirm it's alive
        if (req.method === 'POST' && req.url === '/signal') {
            try {
                const cfgPath = path.join(os.tmpdir(), 'agy-config.json');
                fs.writeFileSync(cfgPath, JSON.stringify(this._config), 'utf8');
            } catch {}
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            this._signalReceived = true;
            if (this._onSignal) { this._onSignal(); }
            return;
        }

        // POST /heartbeat — inject script pings every 5s
        if (req.method === 'POST' && req.url === '/heartbeat') {
            this._lastHeartbeat = Date.now();
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('ok');
            return;
        }

        // GET /health — restore probe
        if (req.method === 'GET' && req.url === '/health') {
            const now = Date.now();
            const health = {
                port: this._port,
                uptime: now - this._startTime,
                lastHeartbeat: this._lastHeartbeat,
                scriptAlive: this._lastHeartbeat > 0 && (now - this._lastHeartbeat) < 15000,
                config: this._config
            };
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(health));
            return;
        }

        // POST /clicked — injected script reports each button click
        if (req.method === 'POST' && req.url === '/clicked') {
            let body = '';
            req.on('data', (chunk: string) => body += chunk);
            req.on('end', () => {
                res.writeHead(200, { 'Content-Type': 'text/plain' });
                res.end('ok');
                try {
                    const data = JSON.parse(body);
                    if (this._onClicked) { this._onClicked(data); }
                } catch {}
            });
            return;
        }

        // CORS preflight
        if (req.method === 'OPTIONS') {
            res.writeHead(204, {
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            res.end();
            return;
        }

        // GET / — return config JSON
        const body = JSON.stringify(this._config);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
    }

    /** Save session info so extension can restore after reload */
    private _saveSession() {
        try {
            fs.writeFileSync(this._sessionFile, JSON.stringify({
                port: this._port,
                pid: process.pid,
                startTime: this._startTime
            }), 'utf8');
        } catch {}
    }

    /**
     * Try to restore a previous session by probing the saved port.
     * Returns { port, config, scriptAlive } or null.
     */
    static async tryRestore(projectName = ''): Promise<{ port: number; config: ScanConfig; scriptAlive: boolean } | null> {
        try {
            const raw = fs.readFileSync(sessionFilePath(projectName), 'utf8');
            const session = JSON.parse(raw);
            if (!session.port) { return null; }

            // Probe /health
            return new Promise((resolve) => {
                const req = http.get(`http://127.0.0.1:${session.port}/health`, { timeout: 2000 }, (res) => {
                    let body = '';
                    res.on('data', (chunk: string) => body += chunk);
                    res.on('end', () => {
                        try {
                            const health = JSON.parse(body);
                            resolve({
                                port: health.port,
                                config: health.config,
                                scriptAlive: health.scriptAlive
                            });
                        } catch { resolve(null); }
                    });
                });
                req.on('error', () => resolve(null));
                req.on('timeout', () => { req.destroy(); resolve(null); });
            });
        } catch { return null; }
    }

    /** Register a one-shot callback for when the injected script signals. */
    onSignal(cb: () => void) { this._onSignal = cb; }

    /** Register callback for click reports from injected script. */
    onClicked(cb: (data: any) => void) { this._onClicked = cb; }

    update(patch: Partial<ScanConfig>) {
        Object.assign(this._config, patch);
    }

    get config(): Readonly<ScanConfig> { return this._config; }
    get port(): number { return this._port; }

    /** Check if the injected script has sent its /signal POST */
    get hasScriptSignal(): boolean { return this._signalReceived; }

    /** Reset signal flag (call before re-injection) */
    resetSignal() { this._signalReceived = false; this._lastHeartbeat = 0; }

    /** Reattach to an existing running server (skip creating new one) */
    attachToPort(port: number) {
        this._port = port;
        // We don't own the server — it's from a previous extension host instance
        // that's still alive in the same Node process. Just update our port reference.
    }

    dispose() {
        this._server?.close();
        this._server = null;
        // Clean up session file
        try { fs.unlinkSync(this._sessionFile); } catch {}
    }
}
