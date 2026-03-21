import * as vscode from 'vscode';
import { getToolCacheSize } from '../tools.d/cache';

/**
 * Status bar button for clearing tool cache.
 * Implements Singleton pattern for global access.
 */
export class ClearCacheButton implements vscode.Disposable {
    private static _instance: ClearCacheButton;
    private statusBarItem: vscode.StatusBarItem;
    private disposables: vscode.Disposable[] = [];

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        this.disposables.push(this.statusBarItem);
        
        this.statusBarItem.tooltip = 'Click to clear tool result cache';
        this.statusBarItem.command = 'mutsumi.clearToolCache';
        
        this.update();
        this.statusBarItem.show();
    }

    /**
     * Gets the singleton instance.
     */
    public static getInstance(): ClearCacheButton {
        if (!ClearCacheButton._instance) {
            ClearCacheButton._instance = new ClearCacheButton();
        }
        return ClearCacheButton._instance;
    }

    /**
     * Updates the button display based on current cache size.
     */
    public update(): void {
        const size = getToolCacheSize();
        const text = size === 1 ? '1 Cache' : `${size} Caches`;
        this.statusBarItem.text = `$(clear-all) Clean ${text}`;
    }

    dispose(): void {
        this.disposables.forEach(d => d.dispose());
        ClearCacheButton._instance = undefined as any;
    }
}
