# Changelog

## [1.0.74] — 2026-03-18
### Changed
- fix: verify injection via signal confirmation


## [1.0.73] — 2026-03-18
### Changed
- fix: verify injection via signal confirmation — re-inject on failed paste instead of falsely skipping


## [1.0.72] — 2026-03-18
### Changed
- fix: verify injection via signal confirmation — re-inject on failed paste instead of falsely skipping


## [1.0.71] — 2026-03-17
### Changed
- chore: rename extension displayName to Antigravity Auto Run Always Click


## [1.0.70] — 2026-03-17
### Changed
- feat: add CHANGELOG.md to extension package for Open VSX change history


All notable changes to **Antigravity Always Run** will be documented in this file.

## [1.0.69] — 2026-03-17
### Changed
- docs: clarify native macro approach over CDP and eliminate need for custom launcher flags

## [1.0.68] — 2026-03-17
### Changed
- perf: radically eliminate DevTools macro injection delays by caching C# interop DLL and shifting clipboard manipulation out of PowerShell

## [1.0.67] — 2026-03-17
### Changed
- perf: optimize DevTools paste speed — reduce artificial delays across all platforms
- fix: add "allow" matcher to auto-click targets
- fix: revert Ctrl+Shift+J shortcut, use command palette method for Console tab

## [1.0.66] — 2026-03-16
### Added
- feat: per-button toggle controls (Yes, Run, Retry, Accept)
- feat: activity log with last 50 entries and auto-scroll
- feat: session restore — reconnects to existing ConfigServer on window reload

## [1.0.65] — 2026-03-16
### Added
- feat: collapsible risk warning banner (auto-detects English/Vietnamese)
- feat: clickable referral link for Google AI Ultra
- feat: "Retry" added to auto-clickable buttons

## [1.0.64] — 2026-03-16
### Added
- Initial public release
- Auto-clicks Yes, Run, Accept, Approve, Confirm buttons
- Deep scan: main window, iframes, shadow DOM, webviews
- Manual setup fallback for restricted platforms
