import * as vscode from 'vscode';
import { AutoAcceptPanelProvider } from './AutoAcceptPanel';
export function activate(context: vscode.ExtensionContext) {
    console.log('[Always Run] Extension activated');

    // Register the webview panel provider for the side panel
    const provider = new AutoAcceptPanelProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            AutoAcceptPanelProvider.viewType,
            provider,
            {
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-always-run.toggleAutoClick', () => {
            provider.toggleAutoClick();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-always-run.stop', () => {
            provider.stopAutoClick();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('antigravity-always-run.injectScript', async () => {
            await provider.injectScript();
        })
    );

    console.log('[Always Run] All features registered');
}

export function deactivate() {
    console.log('[Always Run] Extension deactivated');
}
