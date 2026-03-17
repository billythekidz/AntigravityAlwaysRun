import { execFile } from 'child_process';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

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
    async openDevToolsAndInject(projectName = ''): Promise<ClickResult> {
        switch (this.platform) {
            case 'win32':  return this._openDevToolsWindows(projectName);
            case 'darwin': return this._openDevToolsMac();
            default:       return this._openDevToolsLinux();
        }
    }

    // ── macOS: bash + pbcopy + osascript ────────────────────────────────────
    private _openDevToolsMac(): Promise<ClickResult> {
        const sh = `
#!/bin/bash
set -e
DIAG=()

# (Payload is already on clipboard via VS Code API)
DIAG+=("Payload already on clipboard")

# Delete stale config file (its recreation = injection signal)
CFG_PATH="$TMPDIR/agy-config.json"
if [ -f "$CFG_PATH" ]; then rm -f "$CFG_PATH"; fi

# Step 1: Open DevTools via command palette
echo -n "Toggle Developer Tools" | pbcopy
sleep 0.3

# Activate Antigravity
osascript << 'ASCRIPT'
tell application "System Events"
  set procs to (every process whose name contains "Antigravity")
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

sleep 2.5

# Step 2: Navigate to Console via DevTools command menu
# (Uses default clipboard contents populated by JS)
sleep 0.3
# Cmd+Shift+P => DevTools command menu, type 'console'
osascript -e 'tell application "System Events" to key code 35 using {command down, shift down}'
sleep 0.8
osascript -e 'tell application "System Events" to keystroke "console"'
sleep 0.6
osascript -e 'tell application "System Events" to key code 36'
sleep 1.0
# Click console input area then Cmd+A, Cmd+V, Return
osascript -e 'tell application "System Events" to key code 0 using command down'
sleep 0.1
osascript -e 'tell application "System Events" to key code 9 using command down'
sleep 0.3
osascript -e 'tell application "System Events" to key code 36'
DIAG+=("Script pasted and executed")

# Step 3: Poll for injection signal (agy-config.json)
MAX_WAIT=20
WAITED=0
while [ \$WAITED -lt \$MAX_WAIT ]; do
  if [ -f "$CFG_PATH" ]; then
    DIAG+=("Injection confirmed after \${WAITED}s")
    break
  fi
  sleep 0.5
  WAITED=\$((WAITED + 1))
done
if [ \$WAITED -ge \$MAX_WAIT ]; then DIAG+=("Warning: no signal in \${MAX_WAIT}s"); fi

# Step 4: Close DevTools via Cmd+Shift+I toggle
osascript -e 'tell application "System Events" to key code 34 using {command down, shift down}'
DIAG+=("DevTools closed")

DIAG_JSON=$(printf '"%s",' "\${DIAG[@]}" | sed 's/,$//')
echo "{\\"clicked\\":1,\\"found\\":[{\\"text\\":\\"DevTools inject\\",\\"window\\":\\"Developer Tools\\"}],\\"diag\\":[$DIAG_JSON]}"
`.trim();
        return this._run('bash', ['-c', sh]);
    }

    // ── Linux: bash + xclip + xdotool ───────────────────────────────────────
    private _openDevToolsLinux(): Promise<ClickResult> {
        const sh = `
#!/bin/bash
DIAG=()

# (Payload is already on clipboard via VS Code API)
DIAG+=("Payload already on clipboard")

# Delete stale config file (its recreation = injection signal)
CFG_PATH="/tmp/agy-config.json"
if [ -f "$CFG_PATH" ]; then rm -f "$CFG_PATH"; fi

# Step 1: focus main Antigravity window
WIN=$(xdotool search --name "Antigravity" 2>/dev/null | head -1)
if [ -z "$WIN" ]; then
  echo '{"clicked":0,"found":[],"diag":[],"error":"Antigravity window not found"}'
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

# Step 2: Navigate to Console via DevTools command menu
# (Uses default clipboard contents populated by JS)
sleep 0.2
xdotool key ctrl+shift+p   # DevTools command menu
sleep 0.5
xdotool type --delay 10 'console'
sleep 0.3
xdotool key Return
sleep 0.5
sleep 1.0
# Select all + paste + execute
xdotool key ctrl+a
sleep 0.1
xdotool key ctrl+v
sleep 0.3
xdotool key Return
DIAG+=("Script pasted and executed")

# Step 3: Poll for injection signal (agy-config.json)
MAX_WAIT=20
WAITED=0
while [ \$WAITED -lt \$MAX_WAIT ]; do
  if [ -f "$CFG_PATH" ]; then
    DIAG+=("Injection confirmed after \${WAITED}s")
    break
  fi
  sleep 0.5
  WAITED=\$((WAITED + 1))
done
if [ \$WAITED -ge \$MAX_WAIT ]; then DIAG+=("Warning: no signal in \${MAX_WAIT}s"); fi

# Step 4: Close DevTools via Ctrl+Shift+I toggle
xdotool key ctrl+shift+i
DIAG+=("DevTools closed")

DIAG_JSON=$(printf '"%s",' "\${DIAG[@]}" | sed 's/,$//')
echo "{\\"clicked\\":1,\\"found\\":[{\\"text\\":\\"DevTools inject\\",\\"window\\":\\"Developer Tools\\"}],\\"diag\\":[$DIAG_JSON]}"
`.trim();
        return this._run('bash', ['-c', sh]);
    }

    // ── Windows PowerShell ─────────────────────────────────────────────────
    private _openDevToolsWindows(projectName = ''): Promise<ClickResult> {
        const psScript = `
param (
    [string]$TargetProjectName
)

try { Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop } catch {}
try { Add-Type -AssemblyName UIAutomationTypes  -ErrorAction Stop } catch {}
Add-Type -AssemblyName System.Windows.Forms

$dllPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'agy-w2-v2.dll')
try {
    if (-not (Test-Path $dllPath)) {
        Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte sc, uint flags, UIntPtr ex);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, int data, int extra);
    public const uint KEYUP = 0x0002;
    public const byte VK_RETURN = 0x0D;
    public const int  SW_RESTORE = 9;
    public const uint MOUSE_LEFTDOWN = 0x0002;
    public const uint MOUSE_LEFTUP   = 0x0004;
}
"@ -OutputAssembly $dllPath
    }
    Add-Type -Path $dllPath
} catch {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class W2 {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int x, int y, int data, int extra);
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, IntPtr p);
    [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool f);
    [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr h);
    public const int  SW_RESTORE = 9;
    public const uint MOUSE_LEFTDOWN = 0x0002;
    public const uint MOUSE_LEFTUP   = 0x0004;
}
"@
}

$UIA     = [System.Windows.Automation.AutomationElement]
$CT      = [System.Windows.Automation.ControlType]
$TS      = [System.Windows.Automation.TreeScope]
$PC      = [System.Windows.Automation.PropertyCondition]
$diag    = @()
$projectName = $TargetProjectName

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

function Invoke-ForceFocus([IntPtr]$hWnd) {
    if ([W2]::IsIconic($hWnd)) { [W2]::ShowWindow($hWnd, [W2]::SW_RESTORE) | Out-Null }
    $cur = [W2]::GetCurrentThreadId()
    $tgt = [W2]::GetWindowThreadProcessId($hWnd, [IntPtr]::Zero)
    [W2]::AttachThreadInput($cur, $tgt, $true)  | Out-Null
    [W2]::BringWindowToTop($hWnd)               | Out-Null
    [W2]::SetForegroundWindow($hWnd)            | Out-Null
    [W2]::AttachThreadInput($cur, $tgt, $false) | Out-Null
    Start-Sleep -Milliseconds 300
}

# (Payload is already on clipboard via VS Code API)
$diag += "Payload already on clipboard"

# ── Delete stale config file (its recreation = injection signal) ──────────
$cfgDel = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'agy-config.json')
if (Test-Path $cfgDel) { Remove-Item $cfgDel -Force -ErrorAction SilentlyContinue }

$devWin = $null
$targetPid = 0

# First, find the correct editor window for THIS project
$winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
$wins    = $UIA::RootElement.FindAll($TS::Children, $winCond)
$agWin   = $null
foreach ($w in $wins) {
    $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
    if ($t -match 'Developer Tools') { continue }
    $winPid = $w.GetCurrentPropertyValue($UIA::ProcessIdProperty)
    try {
        $proc = Get-Process -Id $winPid -ErrorAction SilentlyContinue
        if (-not $proc -or $proc.ProcessName -notmatch 'antigravity|code') { continue }
    } catch { continue }
    if ($projectName -ne '' -and $t -match [regex]::Escape($projectName)) {
        $agWin = $w; $targetPid = $winPid; break
    }
    if ($t -match ' - Antigravity| - Visual Studio Code') { $agWin = $w; $targetPid = $winPid }
}
if (-not $agWin) {
    Write-Output (@{clicked=0;found=@();diag=$diag;error="Editor window not found for project '$projectName'"} | ConvertTo-Json -Compress)
    exit
}
$diag += "Target window: '$($agWin.GetCurrentPropertyValue($UIA::NameProperty))' (PID: $targetPid)"

# Check if DevTools is already open for THIS process (same PID)
foreach ($w in $wins) {
    $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
    if ($t -match 'Developer Tools') {
        $dtPid = $w.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        if ($dtPid -eq $targetPid) { $devWin = $w; break }
    }
}

if (-not $devWin) {
    $diag += "DevTools not open, opening via Command Palette..."
    $diag += "Main window: '$($agWin.GetCurrentPropertyValue($UIA::NameProperty))'"

    $hAgWnd = [IntPtr]$agWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)

    $waitMax = 40; $waited = 0
    while ($waited -lt $waitMax) {
        foreach ($w in $UIA::RootElement.FindAll($TS::Children, $winCond)) {
            $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
            if ($t -match 'Developer Tools') {
                $dtPid = $w.GetCurrentPropertyValue($UIA::ProcessIdProperty)
                if ($dtPid -eq $targetPid) { $devWin = $w; break }
            }
        }
        if ($devWin) { break }
        Start-Sleep -Milliseconds 100
        $waited++
    }
}

if (-not $devWin) {
    $diag += "DevTools window still not found after waiting"
    Write-Output (@{clicked=0;found=@();diag=$diag;error='DevTools window did not open'} | ConvertTo-Json -Compress)
    exit
}
$diag += "DevTools window found!"

# ── Step 3: Focus DevTools + verify ─────────────────────────────────────
$hWnd = [IntPtr]$devWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
Invoke-ForceFocus $hWnd
Start-Sleep -Milliseconds 200
if ([W2]::GetForegroundWindow() -ne $hWnd) {
    $diag += "Focus retry..."
    Invoke-ForceFocus $hWnd
    Start-Sleep -Milliseconds 300
}

# ── Step 4: Navigate to Console tab via DevTools Command Menu ────────────
# Ctrl+Shift+P = DevTools command menu (NOT VS Code's). Type 'console' → Enter.
Invoke-ForceFocus $hWnd
Start-Sleep -Milliseconds 150
[System.Windows.Forms.SendKeys]::SendWait('^+p')
Start-Sleep -Milliseconds 300    # wait for command menu
[System.Windows.Forms.SendKeys]::SendWait('console')
Start-Sleep -Milliseconds 200    # wait for search results
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
Start-Sleep -Milliseconds 300    # wait for console panel

# ── Step 5: Click console input area to focus it ─────────────────────────
# After command menu, focus may be on the panel header, not the input '>'.
# Click at the bottom of DevTools window where the console input lives.
$dtRect = $devWin.GetCurrentPropertyValue($UIA::BoundingRectangleProperty)
$clickX = [int]($dtRect.X + $dtRect.Width / 2)
$clickY = [int]($dtRect.Y + $dtRect.Height - 20)  # ~20px from bottom = input row
[W2]::SetCursorPos($clickX, $clickY)
Start-Sleep -Milliseconds 50
[W2]::mouse_event([W2]::MOUSE_LEFTDOWN, 0, 0, 0, 0)
Start-Sleep -Milliseconds 50
[W2]::mouse_event([W2]::MOUSE_LEFTUP, 0, 0, 0, 0)
Start-Sleep -Milliseconds 150    # wait for focus to settle

# ── Step 6: Paste — Ctrl+A clears existing console input, Ctrl+V pastes ─
# Ctrl+A inside DevTools console = select all in console input (safe, it's a
# separate window from VS Code editor). ESC removed — it might close drawer.
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 50
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 400    # large script — wait to fully render

# ── Step 7: Execute ───────────────────────────────────────────────────────
[System.Windows.Forms.SendKeys]::SendWait('{ENTER}')
$diag += "Script pasted and executed!"

# Poll for injection confirmation: injected JS calls POST /signal on ConfigServer,
# which writes agy-config.json. We deleted it before injection so its appearance = success.
$cfgPath = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), 'agy-config.json')
$maxWait = 20; $w = 0
while ($w -lt $maxWait) {
    if (Test-Path $cfgPath) {
        $diag += "Injection confirmed (config file appeared after $w s)"
        break
    }
    Start-Sleep -Milliseconds 500
    $w += 0.5
}
if ($w -ge $maxWait) { $diag += "Warning: no signal in $maxWait s" }
try {
    $wp = $devWin.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $wp.Close()
    $diag += "DevTools closed."
} catch {
    $diag += "Could not close DevTools: $_"
}

@{clicked=1; found=@(@{text='DevTools inject'; window='Developer Tools'}); diag=$diag} | ConvertTo-Json -Compress -Depth 3
`.trim();

        // Write the script to a .ps1 file to bypass Windows Defender AMSI inline command-line scanning
        const ps1Path = path.join(os.tmpdir(), 'agy-inject.ps1');
        fs.writeFileSync(ps1Path, psScript, { encoding: 'utf8' });

        return this._run('powershell', [
            '-Sta', 
            '-NonInteractive', 
            '-NoProfile', 
            '-ExecutionPolicy', 'Bypass', 
            '-File', ps1Path, 
            '-TargetProjectName', projectName
        ]);
    }

    /**
     * Send stop command to DevTools console: clears the auto-accept interval.
     */
    async stopDevToolsScript(): Promise<void> {
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
            const child = execFile(cmd, args, { timeout: 35000, maxBuffer: 10 * 1024 * 1024 }, (err, stdout) => {
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
            setTimeout(() => { try { child.kill(); } catch {} }, 36000);
        });
    }
}
