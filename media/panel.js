// @ts-nocheck
// ═══════════════════════════════════════════════════════════
// Always Run Panel — Webview Client Script
// Runs inside the VS Code side panel webview
// Communicates with the extension host which does the actual
// button scanning in the main Electron renderer window.
// ═══════════════════════════════════════════════════════════

(function () {
    'use strict';

    // Acquire VS Code API
    const vscode = acquireVsCodeApi();

    // ==================== STATE ====================
    const state = {
        isRunning: false,
        totalClicks: 0,
        intervalSec: 3
    };

    // ==================== DOM ELEMENTS ====================
    const statusDot = document.getElementById('status-dot');
    const statusText = document.getElementById('status-text');
    const clickCount = document.getElementById('click-count');
    const toggleBtn = document.getElementById('toggle-btn');
    const logContainer = document.getElementById('log-container');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const scanInfo = document.getElementById('scan-info');
    const projectBadge = document.getElementById('project-badge');

    // Toggle checkboxes
    const toggleYes    = document.getElementById('toggle-yes');
    const toggleRun    = document.getElementById('toggle-run');
    const toggleRetry  = document.getElementById('toggle-retry');
    const toggleAccept = document.getElementById('toggle-accept');

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
        scanInfo.textContent = running ? 'Scanning every ' + state.intervalSec + 's' : 'Stopped';

        // Update toggle button
        if (running) {
            toggleBtn.className = 'btn btn-danger';
            toggleBtn.innerHTML = '<span class="btn-icon">🛑</span> Stop';
        } else {
            toggleBtn.className = 'btn btn-primary';
            toggleBtn.innerHTML = '<span class="btn-icon">▶️</span> Start Auto';
        }
    }

    // ==================== TOGGLE STATE SYNC ====================
    function sendToggleState() {
        vscode.postMessage({
            command: 'toggleUpdate',
            toggles: {
                yes:    toggleYes.checked,
                run:    toggleRun.checked,
                retry:  toggleRetry.checked,
                accept: toggleAccept.checked
            }
        });
    }

    // ==================== EVENT LISTENERS ====================
    toggleBtn.addEventListener('click', function () {
        if (state.isRunning) {
            vscode.postMessage({ command: 'stop' });
            addLog('Stopping scanner...', 'warning');
        } else {
            // Send current toggle states before starting
            sendToggleState();
            vscode.postMessage({ command: 'start' });
            addLog('Starting scanner...', 'info');
        }
    });

    clearLogBtn.addEventListener('click', function () {
        logContainer.innerHTML = '';
        addLog('Log cleared', 'info');
    });

    // Toggle checkboxes — sync state to extension host
    toggleYes.addEventListener('change', function () {
        addLog('Yes: ' + (toggleYes.checked ? 'ON' : 'OFF'), toggleYes.checked ? 'success' : 'warning');
        sendToggleState();
    });
    toggleRun.addEventListener('change', function () {
        addLog('Run: ' + (toggleRun.checked ? 'ON' : 'OFF'), toggleRun.checked ? 'success' : 'warning');
        sendToggleState();
    });
    toggleRetry.addEventListener('change', function () {
        addLog('Retry: ' + (toggleRetry.checked ? 'ON' : 'OFF'), toggleRetry.checked ? 'success' : 'warning');
        sendToggleState();
    });

    // ==================== MESSAGE HANDLER ====================
    // Handle messages from the extension host
    window.addEventListener('message', function (event) {
        const message = event.data;
        switch (message.command) {
            case 'started':
                updateStatus(true);
                addLog('Scanner ACTIVE — scanning main window DOM', 'success');
                break;

            case 'stopped':
                updateStatus(false);
                addLog('Scanner stopped', 'warning');
                break;

            case 'toggleAutoClick':
                if (message.isRunning) {
                    vscode.postMessage({ command: 'start' });
                } else {
                    vscode.postMessage({ command: 'stop' });
                }
                break;

            case 'stop':
                updateStatus(false);
                addLog('Scanner stopped by command', 'warning');
                break;

            case 'scanResult':
                if (message.clicked > 0) {
                    state.totalClicks += message.clicked;
                    clickCount.textContent = state.totalClicks;

                    // Log each clicked button
                    for (var i = 0; i < message.found.length; i++) {
                        var btn = message.found[i];
                        addLog('🖱️ Clicked: "' + btn.text + '" (' + btn.source + ')', 'click');
                    }
                }
                // No log for empty scan cycles — user doesn't need to see them
                break;

            case 'scanError':
                addLog('⚠️ Scan error: ' + message.message, 'warning');
                break;

            case 'diagLog':
                addLog(message.text, message.logType || 'info');
                break;

            case 'projectProfile':
                var p = message.profile;
                if (projectBadge) {
                    projectBadge.textContent = p.projectName || p.label;
                    projectBadge.title = p.projectName || p.description;
                }
                // Apply default toggles from profile
                var dt = p.defaultToggles || { yes: true, run: true, retry: true, accept: true };
                toggleYes.checked = dt.yes;
                toggleRun.checked = dt.run;
                toggleRetry.checked = dt.retry;
                sendToggleState();
                addLog('🔍 Project detected: ' + p.emoji + ' ' + p.label + (p._workspace ? ' (' + p._workspace.split('\\').pop() + ')' : ''), 'info');
                break;

            case 'manualScript':
                var codeEl = document.getElementById('setup-script-code');
                if (codeEl && message.script) {
                    codeEl.textContent = message.script;
                }
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

    // ==================== MANUAL SETUP PANEL ====================
    var setupToggle = document.getElementById('setup-toggle');
    var setupBody = document.getElementById('setup-body');
    var setupChevron = document.getElementById('setup-chevron');
    var setupOpenBtn = document.getElementById('setup-open-devtools');
    var setupCopyBtn = document.getElementById('setup-copy-btn');
    var setupScriptCode = document.getElementById('setup-script-code');

    setupToggle.addEventListener('click', function () {
        setupBody.classList.toggle('hidden');
        setupChevron.classList.toggle('collapsed');
        // Request script from extension host when opening
        if (!setupBody.classList.contains('hidden')) {
            vscode.postMessage({ command: 'requestManualScript' });
        }
    });

    var manualStartBtn = document.getElementById('manual-start-btn');
    manualStartBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'manualStart' });
        addLog('▶️ Manual Start — server started, paste script manually', 'success');
    });

    setupOpenBtn.addEventListener('click', function () {
        vscode.postMessage({ command: 'openDevTools' });
        addLog('🔧 Opening DevTools...', 'info');
    });

    setupCopyBtn.addEventListener('click', function () {
        var code = setupScriptCode.textContent;
        if (code && code !== 'Click "Manual Start" first to generate the script.') {
            navigator.clipboard.writeText(code).then(function () {
                setupCopyBtn.textContent = '✅ Copied!';
                addLog('📋 Script copied to clipboard', 'success');
                setTimeout(function () { setupCopyBtn.textContent = '📋 Copy'; }, 2000);
            }).catch(function () {
                // Fallback
                vscode.postMessage({ command: 'copyScript', script: code });
                setupCopyBtn.textContent = '✅ Copied!';
                setTimeout(function () { setupCopyBtn.textContent = '📋 Copy'; }, 2000);
            });
        } else {
            addLog('⚠️ Click "Start Auto" first to generate the script', 'warning');
        }
    });

    // ==================== SCAN INTERVAL CONTROL ====================
    var intervalInput = document.getElementById('interval-input');
    var intervalDown = document.getElementById('interval-down');
    var intervalUp = document.getElementById('interval-up');

    function setIntervalValue(val) {
        val = Math.max(0.5, Math.min(10000, Math.round(val * 2) / 2)); // snap to 0.5 step
        state.intervalSec = val;
        intervalInput.value = val;
        scanInfo.textContent = state.isRunning ? 'Scanning every ' + val + 's' : 'Stopped';
        vscode.postMessage({ command: 'intervalChange', intervalMs: val * 1000 });
    }

    intervalDown.addEventListener('click', function () {
        setIntervalValue((parseFloat(intervalInput.value) || 3) - 0.5);
    });

    intervalUp.addEventListener('click', function () {
        setIntervalValue((parseFloat(intervalInput.value) || 3) + 0.5);
    });

    intervalInput.addEventListener('change', function () {
        setIntervalValue(parseFloat(intervalInput.value) || 3);
    });

    intervalInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            setIntervalValue(parseFloat(intervalInput.value) || 3);
        }
    });

    // ==================== INIT ====================
    updateStatus(false);
    addLog('Ready. Click "Start Auto" to begin scanning.', 'info');

    // Diagnose button
    var diagnoseBtn = document.getElementById('diagnose-btn');
    if (diagnoseBtn) {
        diagnoseBtn.addEventListener('click', function () {
            vscode.postMessage({ command: 'diagnose' });
        });
    }
})();
