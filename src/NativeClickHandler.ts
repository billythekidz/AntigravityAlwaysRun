import { execFile } from 'child_process';
import * as os from 'os';

export interface ClickResult {
    clicked: number;
    found: { text: string; window: string }[];
    error?: string;
    diag?: string[];
}

export class NativeClickHandler {
    private platform = os.platform();

    async click(matchers: string[], excludes: string[]): Promise<ClickResult> {
        if (matchers.length === 0) { return { clicked: 0, found: [] }; }
        switch (this.platform) {
            case 'win32':  return this._clickWindows(matchers, excludes);
            case 'darwin': return this._clickMacos(matchers, excludes);
            default:       return this._clickLinux(matchers, excludes);
        }
    }

    // ── Windows ─────────────────────────────────────────────────────────────
    // Strategy: UIA can't reach VS Code webview buttons (nested Chromium).
    // Instead: read ALL text from Antigravity window → detect active prompt →
    // send the correct keyboard shortcut to that window.

    private _clickWindows(matchers: string[], excludes: string[]): Promise<ClickResult> {
        const matchersJson = JSON.stringify(matchers);
        const excludesJson = JSON.stringify(excludes);

        const ps = `
$matchersList = '${matchersJson}' | ConvertFrom-Json
$excludesList = '${excludesJson}' | ConvertFrom-Json

try { Add-Type -AssemblyName UIAutomationClient  -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes   -ErrorAction Stop } catch {}
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUser {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);
    public const byte VK_RETURN = 0x0D;
    public const byte VK_MENU   = 0x12;  // Alt
    public const byte VK_TAB    = 0x09;
    public const byte VK_SPACE  = 0x20;
    public const uint KEYUP     = 0x0002;
}
"@

$UIA  = [System.Windows.Automation.AutomationElement]
$CT   = [System.Windows.Automation.ControlType]
$TS   = [System.Windows.Automation.TreeScope]
$PC   = [System.Windows.Automation.PropertyCondition]
$CC   = [System.Windows.Automation.Condition]

$root = $UIA::RootElement
$winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
$windows = $root.FindAll($TS::Children, $winCond)

$found   = @()
$clicked = 0
$diag    = @()
$diag += "Total desktop windows: $($windows.Count)"

# ── Prompt keyword banks ────────────────────────────────────────────────────
$runMarkers  = @('step requires input','requires input','run command','run alt','runalt','reject | run','ask every time')
$yesMarkers  = @('do you want to','would you like','are you sure','confirm','allowing','allow this')

foreach ($win in $windows) {
    try {
        $winPid  = $win.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        $proc  = Get-Process -Id $winPid -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $pnam  = $proc.ProcessName.ToLower()
        if ($pnam -notmatch 'antigravity|code') { continue }

        $title = $win.GetCurrentPropertyValue($UIA::NameProperty)
        $hWnd  = [IntPtr]$win.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
        $diag += "[WINDOW] '$title' proc=$pnam pid=$winPid"

        # ── Read ALL accessible text from the window ────────────────────────
        $allText = [System.Text.StringBuilder]::new()
        try {
            $allElems = $win.FindAll($TS::Subtree, $CC::TrueCondition)
            $diag += "  Total UIA elements: $($allElems.Count)"
            foreach ($el in $allElems) {
                try {
                    $n = $el.GetCurrentPropertyValue($UIA::NameProperty)
                    if ($n -and $n.Trim() -ne '') { $allText.AppendLine($n) | Out-Null }
                } catch {}
            }
        } catch { $diag += "  [TEXT READ ERR] $_" }

        $text = $allText.ToString().ToLower()
        $diag += "  Window text length: $($text.Length) chars"

        # Show sample of what we found
        $sample = ($text -replace '[\\r\\n]+',' ').Trim()
        if ($sample.Length -gt 200) { $sample = $sample.Substring(0,200) + '...' }
        $diag += "  Text sample: $sample"

        # ── Decide which shortcut to send ───────────────────────────────────
        $hasRun     = $matchersList -contains 'run'   -and ($runMarkers | Where-Object { $text.Contains($_) })
        $hasYes     = $matchersList -contains 'yes'   -and ($yesMarkers | Where-Object { $text.Contains($_) })
        $hasRetry   = $matchersList -contains 'retry' -and $text.Contains('retry')

        # Check excludes
        $isExcluded = $false
        foreach ($ex in $excludesList) {
            # Only skip if ONLY excluded text and nothing else
            if ($text.Contains($ex) -and -not $hasRun -and -not $hasYes -and -not $hasRetry) {
                $isExcluded = $true; break
            }
        }

        if ($isExcluded) { $diag += "  Skipping (excluded)"; continue }

        if ($hasRun) {
            $diag += "  Detected RUN prompt! Sending Alt+Enter to window..."
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null
            Start-Sleep -Milliseconds 300
            # Alt+Enter = Run command
            [WinUser]::keybd_event([WinUser]::VK_MENU,    0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN,  0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN,  0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_MENU,    0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            $found   += ,@('Run (Alt+Enter)', $title)
            $clicked++
        } elseif ($hasYes) {
            $diag += "  Detected YES prompt! Sending Enter to window..."
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null
            Start-Sleep -Milliseconds 300
            [WinUser]::keybd_event([WinUser]::VK_RETURN,  0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN,  0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            $found   += ,@('Yes (Enter)', $title)
            $clicked++
        } elseif ($hasRetry) {
            $diag += "  Detected RETRY prompt! Sending Alt+Enter to window..."
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null
            Start-Sleep -Milliseconds 300
            [System.Windows.Forms.SendKeys]::SendWait('%{ENTER}')
            $found   += ,@('Retry (Alt+Enter)', $title)
            $clicked++
        } else {
            $diag += "  No matching prompt detected in window text"
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

    // ── macOS ────────────────────────────────────────────────────────────────

    private _clickMacos(matchers: string[], _excludes: string[]): Promise<ClickResult> {
        const wantsRun   = matchers.includes('run');
        const wantsYes   = matchers.includes('yes');
        const wantsRetry = matchers.includes('retry');

        const script = `
set diag to {}
set clicked to 0
set foundList to {}

tell application "System Events"
    set procs to every process whose (name contains "Antigravity" or name contains "code" or name contains "Code")
    repeat with proc in procs
        set pName to name of proc
        set end of diag to "[PROC] " & pName
        try
            set wins to every window of proc
            repeat with win in wins
                set wName to name of win
                set end of diag to "  [WIN] " & wName
                -- Get all window text
                set winText to ""
                try
                    set allElems to every UI element of win
                    repeat with el in allElems
                        try
                            set winText to winText & (value of el as string) & " "
                        end try
                    end repeat
                end try
                set winTextLow to do shell script "echo " & quoted form of winText & " | tr '[:upper:]' '[:lower:]'"
                set end of diag to "  text len=" & (length of winText)
                
                ${wantsRun ? `
                if winTextLow contains "requires input" or winTextLow contains "run command" then
                    set end of diag to "  RUN prompt detected! Sending Cmd+Option+Enter..."
                    tell proc to set frontmost to true
                    delay 0.3
                    key code 36 using {command down, option down}  -- Cmd+Opt+Enter
                    set end of foundList to "Run (keyboard)"
                    set clicked to clicked + 1
                end if` : ''}
                ${wantsYes ? `
                if winTextLow contains "do you want" or winTextLow contains "confirm" then
                    set end of diag to "  YES prompt detected! Sending Enter..."
                    tell proc to set frontmost to true
                    delay 0.3
                    key code 36  -- Enter
                    set end of foundList to "Yes (Enter)"
                    set clicked to clicked + 1
                end if` : ''}
            end repeat
        on error e
            set end of diag to "  [ERR] " & e
        end try
    end repeat
end tell

-- Compose minimal JSON
set jsonFound to "["
repeat with i from 1 to length of foundList
    if i > 1 then set jsonFound to jsonFound & ","
    set jsonFound to jsonFound & "{\\"text\\":\\"" & (item i of foundList) & "\\",\\"window\\":\\"\\"}"
end repeat
set jsonFound to jsonFound & "]"

set jsonDiag to "["
repeat with i from 1 to length of diag
    if i > 1 then set jsonDiag to jsonDiag & ","
    set jsonDiag to jsonDiag & "\\"" & (item i of diag) & "\\""
end repeat
set jsonDiag to jsonDiag & "]"

"{\\"clicked\\":" & clicked & ",\\"found\\":" & jsonFound & ",\\"diag\\":" & jsonDiag & "}"
`;
        return this._run('osascript', ['-e', script]);
    }

    // ── Linux ────────────────────────────────────────────────────────────────

    private _clickLinux(_matchers: string[], _excludes: string[]): Promise<ClickResult> {
        const script = `
# Try to detect prompt via xdotool window name and send keyboard shortcut
WID=$(xdotool search --name "Antigravity" 2>/dev/null | head -1)
if [ -z "$WID" ]; then
    echo '{"clicked":0,"found":[],"diag":["No Antigravity window found via xdotool"]}'
    exit 0
fi
TITLE=$(xdotool getwindowname "$WID" 2>/dev/null)
# Focus and send Alt+Enter
xdotool windowactivate --sync "$WID" 2>/dev/null
sleep 0.3
xdotool key --window "$WID" alt+Return 2>/dev/null
echo "{\\"clicked\\":1,\\"found\\":[{\\"text\\":\\"Run (Alt+Enter)\\",\\"window\\":\\"$TITLE\\"}],\\"diag\\":[\\"Found window: $TITLE\\",\\"Sent Alt+Enter\\"]}"
`;
        return this._run('bash', ['-c', script]);
    }

    // ── Shared runner ────────────────────────────────────────────────────────

    private _run(cmd: string, args: string[]): Promise<ClickResult> {
        return new Promise((resolve) => {
            const child = execFile(cmd, args, { timeout: 10000 }, (err, stdout) => {
                if (err && !stdout) {
                    resolve({ clicked: 0, found: [], error: err.message });
                    return;
                }
                try {
                    const parsed = JSON.parse(stdout.trim());
                    resolve({
                        clicked: Number(parsed.clicked) || 0,
                        found: Array.isArray(parsed.found) ? parsed.found : [],
                        diag: Array.isArray(parsed.diag) ? parsed.diag : [],
                        error: parsed.error
                    });
                } catch {
                    resolve({ clicked: 0, found: [], error: 'Parse error: ' + stdout.slice(0, 400) });
                }
            });
            setTimeout(() => { try { child.kill(); } catch {} }, 11000);
        });
    }
}
