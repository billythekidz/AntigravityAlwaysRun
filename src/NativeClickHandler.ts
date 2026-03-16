import { execFile } from 'child_process';
import * as os from 'os';

export interface ClickResult {
    clicked: number;
    found: { text: string; window: string }[];
    error?: string;
}

export class NativeClickHandler {
    private platform = os.platform();

    /**
     * Find and click matching buttons in all Antigravity/Code windows.
     * Uses platform-appropriate accessibility APIs.
     */
    async click(
        matchers: string[],
        excludes: string[]
    ): Promise<ClickResult> {
        if (matchers.length === 0) {
            return { clicked: 0, found: [] };
        }
        switch (this.platform) {
            case 'win32':  return this._clickWindows(matchers, excludes);
            case 'darwin': return this._clickMacos(matchers, excludes);
            default:       return this._clickLinux(matchers, excludes);
        }
    }

    // ── Windows: PowerShell UIAutomationClient ──────────────────────────────

    private _clickWindows(matchers: string[], excludes: string[]): Promise<ClickResult> {
        const matchersJson  = JSON.stringify(matchers);
        const excludesJson  = JSON.stringify(excludes);

        // Build inline PowerShell. Passed as -Command to avoid temp-file
        const ps = /* ps1 */`
$matchersList = '${matchersJson}' | ConvertFrom-Json
$excludesList = '${excludesJson}' | ConvertFrom-Json

try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop } catch {}

$found   = @()
$clicked = 0
$diag    = @()
$UIA     = [System.Windows.Automation.AutomationElement]
$CT      = [System.Windows.Automation.ControlType]
$TS      = [System.Windows.Automation.TreeScope]
$PC      = [System.Windows.Automation.PropertyCondition]

$root    = $UIA::RootElement
$winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
$btnCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Button)
$allBtnCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Button)
$windows = $root.FindAll($TS::Children, $winCond)
$diag += "Windows on desktop: $($windows.Count)"

foreach ($win in $windows) {
    try {
        $pid  = $win.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $pnam = $proc.ProcessName.ToLower()
        if ($pnam -notmatch 'antigravity|code') { continue }

        $title   = $win.GetCurrentPropertyValue($UIA::NameProperty)
        $diag += "  [WINDOW] $title (proc=$pnam pid=$pid)"

        $buttons = $win.FindAll($TS::Subtree, $btnCond)
        $diag += "    Buttons found: $($buttons.Count)"

        foreach ($btn in $buttons) {
            try {
                $name = $btn.GetCurrentPropertyValue($UIA::NameProperty)
                if (-not $name) { continue }
                $low  = $name.ToLower()
                $diag += "    [BTN] '$name'"

                $skip = $false
                foreach ($ex in $excludesList) {
                    if ($low.Contains($ex)) { $skip = $true; $diag += "      -> EXCLUDED by '$ex'"; break }
                }
                if ($skip) { continue }

                $matched = $false
                foreach ($m in $matchersList) {
                    if ($low.Contains($m)) {
                        $matched = $true
                        $ok = $btn.GetCurrentPropertyValue($UIA::IsEnabledProperty)
                        $diag += "      -> MATCH '$m' enabled=$ok"
                        if ($ok) {
                            try {
                                $ip = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                                $ip.Invoke()
                                $found   += ,@($name, $title)
                                $clicked++
                                $diag += "      -> CLICKED!"
                            } catch { $diag += "      -> Click FAILED: $_" }
                        }
                        break
                    }
                }
                if (-not $matched) { $diag += "      -> no match" }
            } catch { $diag += "    [BTN ERR] $_" }
        }
    } catch { $diag += "  [WIN ERR] $_" }
}

$out = [PSCustomObject]@{
    clicked = $clicked
    found   = @($found | ForEach-Object { [PSCustomObject]@{ text = $_[0]; window = $_[1] } })
    diag    = $diag
}
$out | ConvertTo-Json -Compress -Depth 4
`.trim();

        return this._run('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps]);
    }

    // ── macOS: AppleScript ──────────────────────────────────────────────────

    private _clickMacos(matchers: string[], excludes: string[]): Promise<ClickResult> {
        const matchStr  = matchers.map(m => `"${m}"`).join(', ');
        const excludeStr = excludes.map(e => `"${e}"`).join(', ');

        const script = `
set matchers to {${matchStr}}
set excludes to {${excludeStr}}
set clickedCount to 0
set foundList to {}

tell application "System Events"
    set procs to every process whose (name contains "Antigravity" or name contains "code" or name contains "Code")
    repeat with proc in procs
        try
            set wins to every window of proc
            repeat with win in wins
                set allBtns to every button of win
                repeat with btn in allBtns
                    try
                        set bName to name of btn as string
                        set bLow to do shell script "echo " & quoted form of bName & " | tr '[:upper:]' '[:lower:]'"
                        set isExcluded to false
                        repeat with ex in excludes
                            if bLow contains ex then set isExcluded to true
                        end repeat
                        if isExcluded then next repeat -- skip
                        repeat with m in matchers
                            if bLow contains m then
                                click btn
                                set clickedCount to clickedCount + 1
                                set end of foundList to bName
                                exit repeat
                            end if
                        end repeat
                    end try
                end repeat
            end repeat
        end try
    end repeat
end tell

-- Return minimal JSON
set jsonFound to "["
repeat with i from 1 to length of foundList
    if i > 1 then set jsonFound to jsonFound & ","
    set jsonFound to jsonFound & "{\\"text\\":\\"" & (item i of foundList) & "\\",\\"window\\":\\"\\"}"
end repeat
set jsonFound to jsonFound & "]"
"{" & "\\"clicked\\":" & clickedCount & ",\\"found\\":" & jsonFound & "}"
`;
        return this._run('osascript', ['-e', script]);
    }

    // ── Linux: AT-SPI via python3/atspi or xdotool fallback ───────────────

    private _clickLinux(matchers: string[], excludes: string[]): Promise<ClickResult> {
        const matchersStr = matchers.map(m => `"${m}"`).join(' ');
        const excludesStr = excludes.map(e => `"${e}"`).join(' ');

        // Use xdotool to find Antigravity windows by name and search buttons via AT-SPI dump
        const script = `
MATCHERS=(${matchersStr})
EXCLUDES=(${excludesStr})
CLICKED=0
FOUND="[]"

# Try python3 + pyatspi for proper accessibility scanning
if command -v python3 &>/dev/null; then
python3 - <<PYEOF
import sys, json
try:
    import pyatspi
    MATCHERS = ${JSON.stringify(matchers)}
    EXCLUDES = ${JSON.stringify(excludes)}
    found = []
    clicked = 0
    desk = pyatspi.Registry.getDesktop(0)
    for app in desk:
        if not app: continue
        aname = (app.name or '').lower()
        if 'antigravity' not in aname and 'code' not in aname: continue
        for win in app:
            if not win: continue
            def scan(node):
                global clicked
                for i in range(node.childCount):
                    try:
                        child = node[i]
                        if not child: continue
                        role = child.getRoleName()
                        if role == 'push button':
                            name = (child.name or '').lower()
                            excl = any(e in name for e in EXCLUDES)
                            if not excl:
                                for m in MATCHERS:
                                    if m in name:
                                        try:
                                            action = child.queryAction()
                                            for a in range(action.nActions):
                                                if action.getName(a) in ('click', 'press', 'activate'):
                                                    action.doAction(a); clicked += 1
                                                    found.append({'text': child.name, 'window': app.name}); break
                                        except: pass
                                        break
                        scan(child)
                    except: pass
            scan(win)
    print(json.dumps({'clicked': clicked, 'found': found}))
except Exception as e:
    # Fallback: xdotool
    import subprocess
    r = subprocess.run(['xdotool','search','--name','Antigravity'], capture_output=True, text=True)
    print(json.dumps({'clicked':0,'found':[],'error':str(e)}))
PYEOF
else
    echo '{"clicked":0,"found":[],"error":"python3 not found, install pyatspi"}'
fi
`.trim();

        return this._run('bash', ['-c', script]);
    }

    // ── Shared runner ───────────────────────────────────────────────────────

    private _run(cmd: string, args: string[]): Promise<ClickResult> {
        return new Promise((resolve) => {
            const child = execFile(cmd, args, { timeout: 8000 }, (err, stdout) => {
                if (err && !stdout) {
                    resolve({ clicked: 0, found: [], error: err.message });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve({
                        clicked: Number(parsed.clicked) || 0,
                        found: Array.isArray(parsed.found) ? parsed.found : [],
                        error: parsed.error
                    });
                } catch {
                    resolve({ clicked: 0, found: [], error: 'Parse error: ' + stdout.slice(0, 200) });
                }
            });
            // Ensure child doesn't block forever
            setTimeout(() => { try { child.kill(); } catch {} }, 9000);
        });
    }
}
