import * as http from 'http';

export interface ScanConfig {
    active: boolean;
    matchers: string[];
    excludes: string[];
    intervalMs: number;
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
    private _config: ScanConfig = {
        active: false,
        matchers: [],
        excludes: ['always run', 'always allow', 'always deny'],
        intervalMs: 3000
    };

    async start(): Promise<number> {
        if (this._server) { return this._port; }  // already running
        return new Promise((resolve, reject) => {
            this._server = http.createServer((_req, res) => {
                const body = JSON.stringify(this._config);
                res.writeHead(200, {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*',
                    'Cache-Control': 'no-cache, no-store'
                });
                res.end(body);
            });
            this._server.listen(0, '127.0.0.1', () => {
                this._port = (this._server!.address() as any).port;
                console.log(`[AlwaysRun] ConfigServer listening on port ${this._port}`);
                resolve(this._port);
            });
            this._server.on('error', reject);
        });
    }

    update(patch: Partial<ScanConfig>) {
        Object.assign(this._config, patch);
    }

    get config(): Readonly<ScanConfig> { return this._config; }
    get port(): number { return this._port; }

    dispose() {
        this._server?.close();
        this._server = null;
    }
}
