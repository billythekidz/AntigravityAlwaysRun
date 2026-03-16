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

    // ── DevTools Console Injection ──────────────────────────────────────────
    /**
     * 1. Open Help > Toggle Developer Tools (if not already open)
     * 2. Focus the DevTools console
     * 3. Paste the encoded script via clipboard → Ctrl+V → Enter
     */
    async openDevToolsAndInject(encodedScript: string): Promise<ClickResult> {
        switch (this.platform) {
            case 'win32':  return this._openDevToolsWindows(encodedScript);
            case 'darwin': return this._openDevToolsMac(encodedScript);
            default:       return this._openDevToolsLinux(encodedScript);
        }
    }

    // ── macOS: bash + pbcopy + osascript ────────────────────────────────────
    private _openDevToolsMac(encodedScript: string): Promise<ClickResult> {
        const sh = `
#!/bin/bash
set -e
DIAG=()

# Decode script
SCRIPT=$(echo '${encodedScript}' | base64 -d)
DIAG+=("Script decoded: \${#SCRIPT} chars")

# Step 1: Open DevTools via command palette
echo -n "Toggle Developer Tools" | pbcopy
sleep 0.3

# Activate Code/Antigravity
osascript << 'ASCRIPT'
tell application "System Events"
  set procs to (every process whose name contains "Antigravity" or name contains "code")
  if (count of procs) > 0 then set frontmost of (first item of procs) to true
end tell
ASCRIPT
sleep 0.5

# Cmd+Shift+P (command palette)
osascript -e 'tell application "System Events" to key code 35 using {command down, shift down}'
sleep 0.6
# Cmd+V (paste command name)
osascript -e 'tell application "System Events" to key code 9 using command down'
sleep 0.4
# Return
osascript -e 'tell application "System Events" to key code 36'
DIAG+=("Command palette: pasted Toggle Developer Tools + Enter")
sleep 2.5

# Step 2: Paste the script into DevTools console
printf '%s' "$SCRIPT" | pbcopy
sleep 0.3
# Cmd+Shift+J => focus console
osascript -e 'tell application "System Events" to key code 38 using {command down, shift down}'
sleep 0.4
# Cmd+A select all, Cmd+V paste
osascript -e 'tell application "System Events" to key code 0 using command down'
sleep 0.1
osascript -e 'tell application "System Events" to key code 9 using command down'
sleep 0.3
# Return => execute
osascript -e 'tell application "System Events" to key code 36'
DIAG+=("Script pasted and executed")

# Step 3: Close DevTools (toggle again)
sleep 0.8
osascript -e 'tell application "System Events" to key code 35 using {command down, shift down}'
osascript -e 'tell application "System Events" to key code 9 using command down'  # paste (re-opens toggle)
osascript -e 'tell application "System Events" to key code 36'
DIAG+=("DevTools closed")

DIAG_JSON=$(printf '"%s",' "\${DIAG[@]}" | sed 's/,$//')
echo "{\\"clicked\\":1,\\"found\\":[{\\"text\\":\\"DevTools inject\\",\\"window\\":\\"Developer Tools\\"}],\\"diag\\":[$DIAG_JSON]}"
`.trim();
        return this._run('bash', ['-c', sh]);
    }

    // ── Linux: bash + xclip + xdotool ───────────────────────────────────────
    private _openDevToolsLinux(encodedScript: string): Promise<ClickResult> {
        const sh = `
#!/bin/bash
DIAG=()
clip_copy() { echo -n "$1" | xclip -selection clipboard 2>/dev/null || echo -n "$1" | xsel --clipboard --input 2>/dev/null; }
clip_copy_data() { printf '%s' "$1" | xclip -selection clipboard 2>/dev/null || printf '%s' "$1" | xsel --clipboard --input 2>/dev/null; }

# Decode script
SCRIPT=$(echo '${encodedScript}' | base64 -d)
DIAG+=("Script decoded: \${#SCRIPT} chars")

# Step 1: focus main Code/Antigravity window
WIN=$(xdotool search --name "Antigravity\\|code" 2>/dev/null | head -1)
if [ -z "$WIN" ]; then
  echo '{"clicked":0,"found":[],"diag":[],"error":"Window not found"}'
  exit 0
fi
xdotool windowfocus --sync "$WIN"
xdotool windowraise "$WIN"
sleep 0.5

# Open command palette via clipboard paste
clip_copy "Toggle Developer Tools"
sleep 0.3
xdotool key ctrl+shift+p
sleep 0.6
xdotool key ctrl+v
sleep 0.4
xdotool key Return
DIAG+=("Command palette: pasted Toggle Developer Tools + Enter")
sleep 2.5

# Step 2: Paste script into DevTools console
clip_copy_data "$SCRIPT"
sleep 0.3
xdotool key ctrl+shift+j   # focus console panel
sleep 0.4
xdotool key ctrl+a
sleep 0.1
xdotool key ctrl+v
sleep 0.3
xdotool key Return
DIAG+=("Script pasted and executed")

sleep 0.8
xdotool key ctrl+shift+i   # close DevTools
DIAG+=("DevTools closed")

DIAG_JSON=$(printf '"%s",' "\${DIAG[@]}" | sed 's/,$//')
echo "{\\"clicked\\":1,\\"found\\":[{\\"text\\":\\"DevTools inject\\",\\"window\\":\\"Developer Tools\\"}],\\"diag\\":[$DIAG_JSON]}"
`.trim();
        return this._run('bash', ['-c', sh]);
    }

    // ── Windows PowerShell ─────────────────────────────────────────────────
    private _openDevToolsWindows(encodedScript: string): Promise<ClickResult> {
        const ps = `
try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop } catch {}
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint flags, UIntPtr ex);
    public const uint KEYUP = 0x0002;
    public const byte VK_RETURN = 0x0D;
    public const byte VK_CTRL   = 0x11;
    public const byte VK_A      = 0x41;
    public const byte VK_V      = 0x56;
}
"@

$UIA     = [System.Windows.Automation.AutomationElement]
$CT      = [System.Windows.Automation.ControlType]
$TS      = [System.Windows.Automation.TreeScope]
$PC      = [System.Windows.Automation.PropertyCondition]
$diag    = @()

function Find-Window([string]$titlePattern) {
    $root    = $UIA::RootElement
    $winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
    $wins    = $root.FindAll($TS::Children, $winCond)
    foreach ($w in $wins) {
        $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
        if ($t -match $titlePattern) { return $w }
    }
    return $null
}

# ── Decode script from base64 ─────────────────────────────────────────────
$scriptBytes   = [System.Convert]::FromBase64String('${encodedScript}')
$scriptContent = [System.Text.Encoding]::UTF8.GetString($scriptBytes)
$diag += "Script decoded: $($scriptContent.Length) chars"

# ── Step 1: Open DevTools if not already open ─────────────────────────────
$devWin = Find-Window 'Developer Tools - vscode-file'
if (-not $devWin) {
    $diag += "DevTools not open — opening via Command Palette..."

    # Find the Antigravity/Code window with the most UIA elements = main editor
    $root    = $UIA::RootElement
    $winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
    $wins    = $root.FindAll($TS::Children, $winCond)
    $agWin   = $null
    $bestCount = -1
    $cc = [System.Windows.Automation.Condition]::TrueCondition
    foreach ($w in $wins) {
        $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
        if ($t -match 'Developer Tools') { continue }
        $winPid = $w.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        try {
            $proc = Get-Process -Id $winPid -ErrorAction SilentlyContinue
            if (-not $proc) { continue }
            $pnam = $proc.ProcessName.ToLower()
            if ($pnam -notmatch 'antigravity|code') { continue }
        } catch { continue }
        try {
            $cnt = $w.FindAll($TS::Subtree, $cc).Count
            if ($cnt -gt $bestCount) { $agWin = $w; $bestCount = $cnt }
        } catch {}
    }
    if (-not $agWin) {
        Write-Output (@{clicked=0;found=@();diag=$diag;error='Antigravity/Code window not found'} | ConvertTo-Json -Compress)
        exit
    }
    $diag += "Main window ($bestCount elems): '$($agWin.GetCurrentPropertyValue($UIA::NameProperty))'"

    # Focus it
    $hWnd = [IntPtr]$agWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
    [W2]::ShowWindow($hWnd, 9) | Out-Null
    [W2]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 600

    # Open Command Palette, paste command name via clipboard (faster + no char-by-char issues)
    [System.Windows.Forms.Clipboard]::SetText('Toggle Developer Tools')
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.SendKeys]::SendWait('^+p')
    Start-Sleep -Milliseconds 700
    [System.Windows.Forms.SendKeys]::SendWait('^v')
    Start-Sleep -Milliseconds 400
    [System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
    $diag += "Command palette: pasted Toggle Developer Tools + Enter"
    Start-Sleep -Milliseconds 2500

    $devWin = Find-Window 'Developer Tools - vscode-file'

}

if (-not $devWin) {
    $diag += "DevTools window still not found after waiting"
    Write-Output (@{clicked=0;found=@();diag=$diag;error='DevTools window did not open'} | ConvertTo-Json -Compress)
    exit
}
$diag += "DevTools window found!"

# ── Step 2: Put script on clipboard and VERIFY ───────────────────────────
try {
    Set-Clipboard -Value $scriptContent
    $diag += "Script copied to clipboard (Set-Clipboard)"
} catch {
    # Fallback to Windows.Forms (already STA now with -Sta flag)
    try {
        [System.Windows.Forms.Clipboard]::SetText($scriptContent)
        $diag += "Script copied to clipboard (WinForms fallback)"
    } catch {
        $diag += "Clipboard error: $_"
        Write-Output (@{clicked=0;found=@();diag=$diag;error="Clipboard: $_"} | ConvertTo-Json -Compress)
        exit
    }
}
# Verify clipboard actually has our content
$verify = Get-Clipboard -Raw
if (-not $verify -or $verify.Length -lt 10) {
    $diag += "Clipboard verify FAILED — content missing"
    Write-Output (@{clicked=0;found=@();diag=$diag;error="Clipboard verify failed"} | ConvertTo-Json -Compress)
    exit
}
$diag += "Clipboard verified OK ($($verify.Length) chars)"

# ── Step 3: Focus DevTools window ────────────────────────────────────────
$hWnd = [IntPtr]$devWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
[W2]::ShowWindow($hWnd, 9) | Out-Null     # SW_RESTORE
[W2]::SetForegroundWindow($hWnd) | Out-Null
Start-Sleep -Milliseconds 400

# ── Step 4: Open console tab (Ctrl+Shift+J → Console panel) ──────────────
[System.Windows.Forms.SendKeys]::SendWait('^+j')
Start-Sleep -Milliseconds 600

# ── Step 5: Click near bottom of DevTools to focus console input ──────────
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse2 {
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern void SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(int f, int x, int y, int d, int e);
    public struct RECT { public int L,T,R,B; }
    public const int MOUSEEVENTF_LEFTDOWN = 0x02;
    public const int MOUSEEVENTF_LEFTUP   = 0x04;
}
"@
$rect = New-Object Mouse2+RECT
[Mouse2]::GetWindowRect($hWnd, [ref]$rect) | Out-Null
$cx = [int](($rect.L + $rect.R) / 2)
$cy = [int]($rect.B - 40)   # near bottom = console input row
[Mouse2]::SetCursorPos($cx, $cy)
[Mouse2]::mouse_event([Mouse2]::MOUSEEVENTF_LEFTDOWN, $cx, $cy, 0, 0)
Start-Sleep -Milliseconds 50
[Mouse2]::mouse_event([Mouse2]::MOUSEEVENTF_LEFTUP,   $cx, $cy, 0, 0)
Start-Sleep -Milliseconds 300

# ── Step 6: Clear any existing text, paste script ─────────────────────────
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 200
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 1000   # large script — give it time to render

# ── Step 7: Execute ───────────────────────────────────────────────────────
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
$diag += "Script pasted and executed!"

# Close DevTools window after execution
Start-Sleep -Milliseconds 2500
try {
    $wp = $devWin.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $wp.Close()
    $diag += "DevTools closed."
} catch {
    $diag += "Could not close DevTools: $_"
}

@{clicked=1; found=@(@{text='DevTools inject'; window='Developer Tools'}); diag=$diag} | ConvertTo-Json -Compress -Depth 3
`.trim();

        return this._run('powershell', ['-Sta', '-NonInteractive', '-NoProfile', '-Command', ps]);
    }

    /**
     * Send stop command to DevTools console: clears the auto-accept interval.
     */
    async stopDevToolsScript(): Promise<void> {
        if (this.platform !== 'win32') { return; }
        const stopScript = Buffer.from('if(window.__agyTimer){clearInterval(window.__agyTimer);window.__agyTimer=null;console.log("[AlwaysRun] Stopped");}').toString('base64');
        const injectStop = await this.openDevToolsAndInject(stopScript);
        console.log('[NativeClickHandler] Stop result:', injectStop.diag?.join(' | '));
    }

    // ── Fallback: periodic text-scan + keyboard shortcut ───────────────────
    async click(matchers: string[], excludes: string[]): Promise<ClickResult> {
        if (matchers.length === 0) { return { clicked: 0, found: [] }; }
        switch (this.platform) {
            case 'win32':  return this._clickWindows(matchers, excludes);
            case 'darwin': return this._clickMacos(matchers, excludes);
            default:       return this._clickLinux(matchers, excludes);
        }
    }

    private _clickWindows(matchers: string[], excludes: string[]): Promise<ClickResult> {
        const matchersJson = JSON.stringify(matchers);
        const excludesJson = JSON.stringify(excludes);

        const ps = `
$matchersList = '${matchersJson}' | ConvertFrom-Json
$excludesList = '${excludesJson}' | ConvertFrom-Json

try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop } catch {}
Add-Type -AssemblyName System.Windows.Forms

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinUser {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk,byte scan,uint flags,UIntPtr extra);
    public const byte VK_RETURN = 0x0D;
    public const byte VK_MENU   = 0x12;
    public const uint KEYUP     = 0x0002;
}
"@

$UIA  = [System.Windows.Automation.AutomationElement]
$CT   = [System.Windows.Automation.ControlType]
$TS   = [System.Windows.Automation.TreeScope]
$PC   = [System.Windows.Automation.PropertyCondition]
$CC   = [System.Windows.Automation.Condition]

$root    = $UIA::RootElement
$winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
$windows = $root.FindAll($TS::Children, $winCond)

$found   = @()
$clicked = 0
$diag    = @("Desktop windows: $($windows.Count)")

$runPhrases   = @('step requires input','requires input','run command','run alt+','reject | run','ask every time','1 step requires')
$yesPhrases   = @('do you want to','would you like','are you sure','1 step requires','confirm')
$retryPhrase  = 'retry failed'

foreach ($win in $windows) {
    try {
        $winPid = $win.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        $proc   = Get-Process -Id $winPid -ErrorAction SilentlyContinue
        if (-not $proc) { continue }
        $pnam   = $proc.ProcessName.ToLower()
        if ($pnam -notmatch 'antigravity|code') { continue }

        $title  = $win.GetCurrentPropertyValue($UIA::NameProperty)
        $hWnd   = [IntPtr]$win.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
        if ($title -match 'Developer Tools') { continue }
        $diag  += "[WIN] '$title'"

        $allElems = $win.FindAll($TS::Subtree, $CC::TrueCondition)
        $sb = [System.Text.StringBuilder]::new()
        foreach ($el in $allElems) {
            try {
                $n = $el.GetCurrentPropertyValue($UIA::NameProperty)
                if ($n) { $sb.AppendLine($n) | Out-Null }
            } catch {}
        }
        $text = $sb.ToString().ToLower()
        $diag += "  elements=$($allElems.Count) textLen=$($text.Length)"

        $wantsRun   = $matchersList -contains 'run'
        $wantsYes   = $matchersList -contains 'yes'
        $wantsRetry = $matchersList -contains 'retry'

        $hasRun   = $wantsRun   -and ($runPhrases  | Where-Object { $text.Contains($_) })
        $hasYes   = $wantsYes   -and ($yesPhrases  | Where-Object { $text.Contains($_) })
        $hasRetry = $wantsRetry -and $text.Contains($retryPhrase)

        if ($hasRun) {
            $phrase = ($runPhrases | Where-Object { $text.Contains($_) }) | Select -First 1
            $diag += "  RUN detected ('$phrase') -> Alt+Enter"
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null; Start-Sleep -Milliseconds 300
            [WinUser]::keybd_event([WinUser]::VK_MENU,   0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_MENU,   0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            $found += ,@("Run (Alt+Enter)", $title); $clicked++
        } elseif ($hasYes) {
            $phrase = ($yesPhrases | Where-Object { $text.Contains($_) }) | Select -First 1
            $diag += "  YES detected ('$phrase') -> Enter"
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null; Start-Sleep -Milliseconds 300
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            $found += ,@("Yes (Enter)", $title); $clicked++
        } elseif ($hasRetry) {
            $diag += "  RETRY detected -> Alt+Enter"
            [WinUser]::SetForegroundWindow($hWnd) | Out-Null; Start-Sleep -Milliseconds 300
            [WinUser]::keybd_event([WinUser]::VK_MENU,   0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, 0,               [UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_RETURN, 0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            [WinUser]::keybd_event([WinUser]::VK_MENU,   0, [WinUser]::KEYUP,[UIntPtr]::Zero)
            $found += ,@("Retry (Alt+Enter)", $title); $clicked++
        } else { $diag += "  No prompt" }
    } catch { $diag += "  [ERR] $_" }
}

@{clicked=$clicked; found=@($found | %{@{text=$_[0];window=$_[1]}}); diag=$diag} | ConvertTo-Json -Compress -Depth 4
`.trim();

        return this._run('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps]);
    }

    private _clickMacos(_m: string[], _e: string[]): Promise<ClickResult> {
        return Promise.resolve({ clicked: 0, found: [], diag: ['macOS: use openDevToolsAndInject instead'] });
    }

    private _clickLinux(_m: string[], _e: string[]): Promise<ClickResult> {
        return Promise.resolve({ clicked: 0, found: [], diag: ['Linux: use openDevToolsAndInject instead'] });
    }

    private _run(cmd: string, args: string[]): Promise<ClickResult> {
        return new Promise((resolve) => {
            const child = execFile(cmd, args, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
                if (err && !stdout) { resolve({ clicked: 0, found: [], error: err.message }); return; }
                // Skip any leading non-JSON text (PowerShell warnings etc.)
                const jsonStart = stdout.indexOf('{');
                const jsonStr = jsonStart >= 0 ? stdout.slice(jsonStart) : stdout;
                try {
                    const parsed = JSON.parse(jsonStr.trim());
                    resolve({
                        clicked: Number(parsed.clicked) || 0,
                        found: Array.isArray(parsed.found) ? parsed.found : [],
                        diag: Array.isArray(parsed.diag) ? parsed.diag : [],
                        error: parsed.error
                    });
                } catch {
                    resolve({ clicked: 0, found: [], error: 'Parse error: ' + stdout.slice(0, 500) });
                }
            });
            setTimeout(() => { try { child.kill(); } catch {} }, 16000);
        });
    }
}
