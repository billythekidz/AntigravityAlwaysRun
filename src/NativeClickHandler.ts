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
        if (this.platform !== 'win32') {
            return { clicked: 0, found: [], diag: ['Windows only for now'] };
        }

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
    $diag += "DevTools not open, sending Ctrl+Shift+I to open..."

    # Find the main Antigravity/Code window (prefer the one with longest title = main editor)
    $root    = $UIA::RootElement
    $winCond = New-Object $PC($UIA::ControlTypeProperty, $CT::Window)
    $wins    = $root.FindAll($TS::Children, $winCond)
    $agWin   = $null
    $bestLen = -1
    foreach ($w in $wins) {
        $t = $w.GetCurrentPropertyValue($UIA::NameProperty)
        $winPid = $w.GetCurrentPropertyValue($UIA::ProcessIdProperty)
        try {
            $proc = Get-Process -Id $winPid -ErrorAction SilentlyContinue
            if (-not $proc) { continue }
            $pnam = $proc.ProcessName.ToLower()
            if ($pnam -notmatch 'antigravity|code') { continue }
        } catch { continue }
        if ($t -notmatch 'Developer Tools' -and $t.Length -gt $bestLen) {
            $agWin = $w; $bestLen = $t.Length
        }
    }
    if (-not $agWin) {
        Write-Output (@{clicked=0;found=@();diag=$diag;error='Antigravity/Code window not found'} | ConvertTo-Json -Compress)
        exit
    }
    $diag += "Found main window: '$($agWin.GetCurrentPropertyValue($UIA::NameProperty))'"

    # Focus the window and send Ctrl+Shift+I (Toggle Developer Tools shortcut)
    $hWnd = [IntPtr]$agWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
    [W2]::ShowWindow($hWnd, 9) | Out-Null  # SW_RESTORE
    [W2]::SetForegroundWindow($hWnd) | Out-Null
    Start-Sleep -Milliseconds 500

    [System.Windows.Forms.SendKeys]::SendWait('^+i')  # Ctrl+Shift+I
    $diag += "Sent Ctrl+Shift+I, waiting for DevTools..."
    Start-Sleep -Milliseconds 2500

    $devWin = Find-Window 'Developer Tools - vscode-file'
}

if (-not $devWin) {
    $diag += "DevTools window still not found after waiting"
    Write-Output (@{clicked=0;found=@();diag=$diag;error='DevTools window did not open'} | ConvertTo-Json -Compress)
    exit
}
$diag += "DevTools window found!"

# ── Step 2: Put script on clipboard ──────────────────────────────────────
try {
    [System.Windows.Forms.Clipboard]::SetText($scriptContent)
    $diag += "Script copied to clipboard"
} catch {
    $diag += "Clipboard error: $_"
    Write-Output (@{clicked=0;found=@();diag=$diag;error="Clipboard: $_"} | ConvertTo-Json -Compress)
    exit
}

# ── Step 3: Focus DevTools window ────────────────────────────────────────
$hWnd = [IntPtr]$devWin.GetCurrentPropertyValue($UIA::NativeWindowHandleProperty)
[W2]::ShowWindow($hWnd, 9) | Out-Null     # SW_RESTORE
[W2]::SetForegroundWindow($hWnd) | Out-Null
Start-Sleep -Milliseconds 400

# ── Step 4: Open console tab with Ctrl+[ (move to Console panel) ─────────
# Press Ctrl+\` to toggle console drawer, or just use Escape then Ctrl+\`
# DevTools shortcut: Ctrl+Shift+J opens Console panel directly (in Chrome)
[System.Windows.Forms.SendKeys]::SendWait('^+j')
Start-Sleep -Milliseconds 400

# ── Step 5: Select all existing text and delete ───────────────────────────
[System.Windows.Forms.SendKeys]::SendWait('^a')
Start-Sleep -Milliseconds 100

# ── Step 6: Paste the script ──────────────────────────────────────────────
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 200

# ── Step 7: Execute ───────────────────────────────────────────────────────
[W2]::keybd_event([W2]::VK_RETURN, 0, 0,        [UIntPtr]::Zero)
[W2]::keybd_event([W2]::VK_RETURN, 0, [W2]::KEYUP, [UIntPtr]::Zero)
$diag += "Script pasted and executed!"

# Close DevTools window after execution
Start-Sleep -Milliseconds 800
try {
    $wp = $devWin.GetCurrentPattern([System.Windows.Automation.WindowPattern]::Pattern)
    $wp.Close()
    $diag += "DevTools closed."
} catch {
    $diag += "Could not close DevTools: $_"
}

@{clicked=1; found=@(@{text='DevTools inject'; window='Developer Tools'}); diag=$diag} | ConvertTo-Json -Compress -Depth 3
`.trim();

        return this._run('powershell', ['-NonInteractive', '-NoProfile', '-Command', ps]);
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
            const child = execFile(cmd, args, { timeout: 15000 }, (err, stdout) => {
                if (err && !stdout) { resolve({ clicked: 0, found: [], error: err.message }); return; }
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
            setTimeout(() => { try { child.kill(); } catch {} }, 16000);
        });
    }
}
