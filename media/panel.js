// @ts-nocheck
// ═══════════════════════════════════════════════════════════
// Always Run Panel — Webview Client Script
// Runs inside the VS Code side panel webview
// ═══════════════════════════════════════════════════════════

(function () {
    'use strict';

    // Acquire VS Code API
    const vscode = acquireVsCodeApi();

    // ==================== STATE ====================
    const state = {
        isRunning: false,
        totalClicks: 0,
        interval: null
    };

    // ==================== DOM ELEMENTS ====================
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const clickCount = document.getElementById('click-count');
    const toggleBtn = document.getElementById('toggle-btn');
    const logContainer = document.getElementById('log-container');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const scanInfo = document.getElementById('scan-info');

    // ==================== LOGGING ====================
    function addLog(text, type) {
        type = type || 'info';
        const entry = document.createElement('div');
        entry.className = 'log-entry log-' + type;
        const time = new Date().toLocaleTimeString();
        entry.textContent = '[' + time + '] ' + text;
        logContainer.appendChild(entry);
        logContainer.scrollTop = logContainer.scrollHeight;

        // Keep only last 50 entries
        while (logContainer.children.length > 50) {
            logContainer.removeChild(logContainer.firstChild);
        }
    }

    // ==================== UI UPDATES ====================
    function updateStatus(running) {
        state.isRunning = running;
        statusDot.className = 'status-dot' + (running ? ' active' : ' stopped');
        statusText.textContent = running ? '● Scanning' : 'Idle';
        scanInfo.textContent = running ? 'Scanning every 3 seconds' : 'Stopped';

        // Update toggle button
        if (running) {
            toggleBtn.className = 'btn btn-danger';
            toggleBtn.innerHTML = '<span class="btn-icon">🛑</span> Stop';
        } else {
            toggleBtn.className = 'btn btn-primary';
            toggleBtn.innerHTML = '<span class="btn-icon">▶️</span> Start Auto';
        }
    }

    function updateCounts() {
        clickCount.textContent = state.totalClicks;
    }

    // ==================== BUTTON SCANNER ====================
    // This runs inside the webview — it can scan the parent window
    // through the VS Code API messaging system
    function startScanning() {
        if (state.interval) {
            clearInterval(state.interval);
        }

        updateStatus(true);
        addLog('Scanner started', 'success');

        // Run an immediate scan
        scanForButtons();

        // Then scan every 3 seconds
        state.interval = setInterval(scanForButtons, 3000);
    }

    function stopScanning() {
        if (state.interval) {
            clearInterval(state.interval);
            state.interval = null;
        }
        updateStatus(false);
        addLog('Scanner stopped', 'warning');
    }

    function scanForButtons() {
        // Since the webview is sandboxed, actual DOM scanning happens
        // via the injected script in the main window.
        // Here we just track the UI state and communicate with the extension.
        if (!state.isRunning) { return; }

        const time = new Date().toLocaleTimeString();
        addLog('Scan cycle complete', 'info');
    }

    // ==================== EVENT LISTENERS ====================
    toggleBtn.addEventListener('click', function () {
        if (state.isRunning) {
            stopScanning();
            vscode.postMessage({ command: 'stop' });
        } else {
            vscode.postMessage({ command: 'inject' });
            startScanning();
            addLog('Script injected via clipboard', 'success');
        }
    });



    clearLogBtn.addEventListener('click', function () {
        logContainer.innerHTML = '';
        addLog('Log cleared', 'info');
    });

    // ==================== MESSAGE HANDLER ====================
    // Handle messages from the extension host
    window.addEventListener('message', function (event) {
        const message = event.data;
        switch (message.command) {
            case 'toggleAutoClick':
                if (message.isRunning) {
                    startScanning();
                } else {
                    stopScanning();
                }
                break;
            case 'stop':
                stopScanning();
                break;
            case 'updateClicks':
                state.totalClicks = message.count || 0;
                updateCounts();
                addLog('Clicked button: ' + (message.buttonText || 'unknown'), 'click');
                break;

            case 'scanResult':
                addLog('Found ' + message.buttonCount + ' button(s) in ' + message.iframeCount + ' frame(s)', 'info');
                break;
        }
    });

    // ==================== WARNING BANNER ====================
    const warningToggle = document.getElementById('warning-toggle');
    const warningBody = document.getElementById('warning-body');
    const warningChevron = document.getElementById('warning-chevron');

    warningToggle.addEventListener('click', function () {
        warningBody.classList.toggle('hidden');
        warningChevron.classList.toggle('collapsed');
    });

    // Handle external links
    document.querySelectorAll('.ext-link').forEach(function (link) {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            var url = link.getAttribute('data-url');
            if (url) {
                vscode.postMessage({ command: 'openExternal', url: url });
            }
        });
    });

    // ==================== BUTTON TOGGLES ====================
    var toggleYes = document.getElementById('toggle-yes');
    var toggleRun = document.getElementById('toggle-run');
    var toggleRetry = document.getElementById('toggle-retry');

    toggleYes.addEventListener('change', function () {
        addLog('Yes: ' + (toggleYes.checked ? 'ON' : 'OFF'), toggleYes.checked ? 'success' : 'warning');
    });
    toggleRun.addEventListener('change', function () {
        addLog('Run: ' + (toggleRun.checked ? 'ON' : 'OFF'), toggleRun.checked ? 'success' : 'warning');
    });
    toggleRetry.addEventListener('change', function () {
        addLog('Retry: ' + (toggleRetry.checked ? 'ON' : 'OFF'), toggleRetry.checked ? 'success' : 'warning');
    });

    // ==================== INIT ====================
    updateStatus(false);
    addLog('Ready. Click "Inject Script" to start.', 'info');
})();
