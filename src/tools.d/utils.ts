import * as vscode from 'vscode';
import * as path from 'path';

export function resolveUri(input: string): vscode.Uri {
    try {
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
            return vscode.Uri.parse(input);
        }
        if (input.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(input)) {
            return vscode.Uri.file(input);
        }
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const root = vscode.workspace.workspaceFolders[0].uri;
            const rootPath = root.path.endsWith('/') ? root.path : root.path + '/';
            const childPath = input.startsWith('/') ? input.substring(1) : input;
            return root.with({ path: rootPath + childPath });
        }
        return vscode.Uri.file(input);
    } catch (e) {
        throw new Error(`Failed to resolve URI from input: ${input}`);
    }
}

export function checkAccess(targetUri: vscode.Uri, allowedUris: string[]): boolean {
    // Normalize target path for comparison (handling OS specifics and case sensitivity)
    const targetPath = path.normalize(targetUri.fsPath).toLowerCase();

    for (const allowed of allowedUris) {
        if (allowed === '/') return true;
        
        let allowedUri: vscode.Uri;
        let allowedPath: string;
        try {
            // If it looks like a URI scheme, parse it
            if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(allowed)) {
                allowedUri = vscode.Uri.parse(allowed);
            } else if (allowed.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(allowed)) {
                // Absolute path
                allowedUri = vscode.Uri.file(allowed);
            } else {
                // Relative path - resolve it the same way as targetUri
                allowedUri = resolveUri(allowed);
            }
            allowedPath = allowedUri.fsPath;
        } catch {
            // Fallback: treat as-is
            allowedPath = allowed;
        }

        const normalizedAllowed = path.normalize(allowedPath).toLowerCase();

        // Exact match
        if (targetPath === normalizedAllowed) return true;

        // Directory match: ensure allowedPath ends with separator
        const separator = path.sep;
        const allowedDir = normalizedAllowed.endsWith(separator) ? normalizedAllowed : normalizedAllowed + separator;
        
        if (targetPath.startsWith(allowedDir)) return true;
    }
    return false;
}

export function getUriKey(uri: vscode.Uri): string {
    return uri.scheme === 'file' ? uri.fsPath : uri.toString();
}

const COMMON_IGNORED = new Set(['node_modules', '.git', '.vscode', 'dist', 'out', 'build', '__pycache__', 'coverage']);

export function isCommonIgnored(name: string): boolean {
    return name.startsWith('.') || COMMON_IGNORED.has(name);
}
