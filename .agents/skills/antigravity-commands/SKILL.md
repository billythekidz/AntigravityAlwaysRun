---
name: antigravity-commands
description: Complete catalog of all Antigravity IDE internal commands discovered via vscode.commands.getCommands(). Use this when building extensions, automation, or testing integrations with Antigravity IDE.
---

# Antigravity IDE Commands Catalog

## Discovery Script

To re-discover commands after an Antigravity IDE update, see:

- [test-pesosz.ts](file:///d:/GITHUB/AntigravityAlwaysRun/src/test-pesosz.ts) — Discovery script that lists all commands via `vscode.commands.getCommands()`, tests execution of auto-accept candidates, and outputs results to the Output panel.

## Auto-Accept Commands (Verified Working)

These are the real commands for auto-accepting agent actions:

| Command | Purpose |
|---------|---------|
| `antigravity.prioritized.agentAcceptAllInFile` | Accept ALL agent diffs in current file |
| `antigravity.prioritized.agentAcceptFocusedHunk` | Accept the currently focused diff hunk |
| `antigravity.prioritized.supercompleteAccept` | Accept supercomplete suggestion |
| `antigravity.acceptCompletion` | Accept code completion |
| `notification.acceptPrimaryAction` | Accept primary notification action |
| `quickInput.accept` | Accept quick input dialog |
| `editor.action.inlineSuggest.commit` | Commit inline suggestion |

### NOT Working (antigravity-plus claimed these)

```
antigravity.agent.acceptAgentStep  → NOT FOUND
antigravity.terminal.accept        → NOT FOUND
```

## Agent Panel Commands

| Command | Purpose |
|---------|---------|
| `antigravity.openAgent` | Open the agent panel |
| `antigravity.agentSidePanel.focus` | Focus the agent side panel |
| `antigravity.agentSidePanel.open` | Open agent side panel |
| `antigravity.agentSidePanel.toggleVisibility` | Toggle agent panel |
| `antigravity.reloadAgentSidePanel` | Reload agent panel |
| `antigravity.sendPromptToAgentPanel` | Send prompt to agent |
| `antigravity.startNewConversation` | Start new agent conversation |
| `antigravity.switchBetweenWorkspaceAndAgent` | Switch workspace ↔ agent |
| `antigravity.toggleChatFocus` | Toggle chat focus |

## Agent Diff Review Commands

| Command | Purpose |
|---------|---------|
| `antigravity.prioritized.agentAcceptAllInFile` | Accept all diffs in file |
| `antigravity.prioritized.agentAcceptFocusedHunk` | Accept focused hunk |
| `antigravity.prioritized.agentRejectAllInFile` | Reject all diffs in file |
| `antigravity.prioritized.agentRejectFocusedHunk` | Reject focused hunk |
| `antigravity.prioritized.agentFocusNextFile` | Focus next file |
| `antigravity.prioritized.agentFocusNextHunk` | Focus next hunk |
| `antigravity.prioritized.agentFocusPreviousFile` | Focus previous file |
| `antigravity.prioritized.agentFocusPreviousHunk` | Focus previous hunk |
| `antigravity.openDiffZones` | Open diff zones |
| `antigravity.closeAllDiffZones` | Close all diff zones |
| `antigravity.setDiffZonesState` | Set diff zones state |
| `antigravity.openReviewChanges` | Open review changes panel |

## DevTools & Debug Commands

| Command | Purpose |
|---------|---------|
| `antigravity.toggleManagerDevTools` | Toggle manager DevTools |
| `antigravity.toggleSettingsDevTools` | Toggle settings DevTools |
| `antigravity.toggleDebugInfoWidget` | Toggle debug info widget |
| `antigravity.updateDebugInfoWidget` | Update debug info |
| `antigravity.getChromeDevtoolsMcpUrl` | Get Chrome DevTools MCP URL |
| `antigravity.getBrowserOnboardingPort` | Get browser onboarding port |
| `antigravity.downloadDiagnostics` | Download diagnostics |
| `antigravity.getDiagnostics` | Get diagnostics |
| `antigravity.getLintErrors` | Get lint errors |

## Editor & Completion Commands

| Command | Purpose |
|---------|---------|
| `antigravity.acceptCompletion` | Accept completion |
| `antigravity.prioritized.supercompleteAccept` | Accept supercomplete |
| `antigravity.prioritized.supercompleteEscape` | Escape supercomplete |
| `antigravity.snoozeAutocomplete` | Snooze autocomplete |
| `antigravity.cancelSnoozeAutocomplete` | Cancel snooze |
| `antigravity.openInteractiveEditor` | Open interactive editor |

## Terminal Commands

| Command | Purpose |
|---------|---------|
| `antigravity.readTerminal` | Read terminal content |
| `antigravity.sendTerminalToSidePanel` | Send terminal to side panel |
| `antigravity.showManagedTerminal` | Show managed terminal |
| `antigravity.onManagerTerminalCommandData` | Terminal command data event |
| `antigravity.onManagerTerminalCommandStart` | Terminal command start event |
| `antigravity.onManagerTerminalCommandFinish` | Terminal command finish event |
| `antigravity.onShellCommandCompletion` | Shell command completion event |
| `antigravity.updateTerminalLastCommand` | Update terminal last command |

## Configuration & Settings Commands

| Command | Purpose |
|---------|---------|
| `antigravity.openMcpConfigFile` | Open MCP config file |
| `antigravity.openMcpDocsPage` | Open MCP docs |
| `antigravity.openConfigurePluginsPage` | Open plugins config |
| `antigravity.openQuickSettingsPanel` | Open quick settings |
| `antigravity.editorModeSettings` | Editor mode settings |
| `antigravity.createRule` | Create a rule |
| `antigravity.createWorkflow` | Create a workflow |
| `antigravity.createGlobalWorkflow` | Create global workflow |
| `antigravity.openRulesEducationalLink` | Open rules docs |
| `antigravity.openCustomizationsTab` | Open customizations |
| `workbench.action.openAntigravitySettings` | Open Antigravity settings |
| `workbench.action.openAntigravitySettingsWithId` | Open settings by ID |

## Browser & External Commands

| Command | Purpose |
|---------|---------|
| `antigravity.openBrowser` | Open browser |
| `antigravity.showBrowserAllowlist` | Show browser allowlist |
| `antigravity.fetchMcpAuthToken` | Fetch MCP auth token |

## Tracing & Telemetry Commands

| Command | Purpose |
|---------|---------|
| `antigravity.captureTraces` | Capture traces |
| `antigravity.enableTracing` | Enable tracing |
| `antigravity.clearAndDisableTracing` | Clear & disable tracing |
| `antigravity.getManagerTrace` | Get manager trace |
| `antigravity.getWorkbenchTrace` | Get workbench trace |
| `antigravity.sendAnalyticsAction` | Send analytics |
| `antigravity.logObservabilityDataAction` | Log observability data |
| `antigravity.tabReporting` | Tab reporting |
| `antigravity.uploadErrorAction` | Upload error |

## System & Window Commands

| Command | Purpose |
|---------|---------|
| `antigravity.reloadWindow` | Reload window |
| `antigravity.killLanguageServerAndReloadWindow` | Kill LS + reload |
| `antigravity.killRemoteExtensionHost` | Kill remote ext host |
| `antigravity.restartLanguageServer` | Restart language server |
| `antigravity.restartUserStatusUpdater` | Restart user status |
| `antigravity.openPersistentLanguageServerLog` | Open LS log |
| `antigravity.togglePersistentLanguageServer` | Toggle persistent LS |
| `antigravity.simulateSegFault` | Simulate seg fault (debug) |

## Import & Migration Commands

| Command | Purpose |
|---------|---------|
| `antigravity.importVSCodeSettings` | Import VS Code settings |
| `antigravity.importVSCodeExtensions` | Import VS Code extensions |
| `antigravity.importVSCodeRecentWorkspaces` | Import VS Code workspaces |
| `antigravity.importCursorSettings` | Import Cursor settings |
| `antigravity.importCursorExtensions` | Import Cursor extensions |
| `antigravity.importWindsurfSettings` | Import Windsurf settings |
| `antigravity.importWindsurfExtensions` | Import Windsurf extensions |
| `antigravity.importCiderSettings` | Import Cider settings |
| `antigravity.migrateWindsurfSettings` | Migrate Windsurf settings |

## Other Useful Commands

| Command | Purpose |
|---------|---------|
| `antigravity.customizeAppIcon` | Customize app icon |
| `antigravity.openChangeLog` | Open changelog |
| `antigravity.openDocs` | Open documentation |
| `antigravity.openIssueReporter` | Open issue reporter |
| `antigravity.openTroubleshooting` | Open troubleshooting |
| `antigravity.generateCommitMessage` | Generate commit message |
| `antigravity.cancelGenerateCommitMessage` | Cancel commit gen |
| `antigravity.playAudio` | Play audio |
| `antigravity.playNote` | Play note |
| `antigravity.artifacts.startComment` | Start artifact comment |
| `antigravity.explainAndFixProblem` | Explain & fix problem |
| `antigravity.isFileGitIgnored` | Check if file is gitignored |
| `antigravity.openGenericUrl` | Open generic URL |

## Stats

- **Total VS Code commands**: 3126
- **Antigravity-related**: 219
- **Discovered**: 2026-03-17 (Antigravity IDE version at discovery time)

> [!IMPORTANT]
> Re-run the discovery test after each Antigravity IDE update — commands may be added or removed.
