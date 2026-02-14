import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Resolve a string input to a vscode.Uri.
 * Supports:
 * - URI strings (e.g. "file:///...", "ftp://...")
 * - Absolute paths (Windows "C:\...", POSIX "/...") -> Tries to infer scheme from workspace
 * - Relative paths -> Resolves against workspace root
 */
export function resolveUri(input: string): vscode.Uri {
    try {
        // 1. If it has a scheme, parse it directly
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
            return vscode.Uri.parse(input);
        }

        // 2. Handle absolute paths (Windows or POSIX)
        const isWinAbs = /^[a-zA-Z]:[\\\/]/.test(input);
        const isPosixAbs = input.startsWith('/');

        if (isWinAbs || isPosixAbs) {
            // If we have a workspace, try to keep the scheme consistent
            if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
                const root = vscode.workspace.workspaceFolders[0].uri;
                // If the root is not local file, apply its scheme to the absolute path
                if (root.scheme !== 'file') {
                    // For remote/virtual fs, we assume the input path is valid on that fs
                    // Note: This constructs uri like scheme://authority/input
                    return root.with({ path: input });
                }
            }
            // Default to local file
            return vscode.Uri.file(input);
        }

        // 3. Handle relative paths
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            const root = vscode.workspace.workspaceFolders[0].uri;
            return vscode.Uri.joinPath(root, input);
        }

        // 4. Fallback: No workspace, treat as local relative/file
        return vscode.Uri.file(input);
    } catch (e) {
        throw new Error(`Failed to resolve URI from input: ${input}`);
    }
}

/**
 * Check if the agent is allowed to access the target URI based on allowed list.
 * Comparisons are done using URI components (scheme, authority, path) rather than fsPath string matching.
 */
export function checkAccess(targetUri: vscode.Uri, allowedUris: string[]): boolean {
    const targetScheme = targetUri.scheme.toLowerCase();
    const targetAuth = targetUri.authority.toLowerCase();
    // Use lower case path for secure comparison (defaulting to case-insensitive safety)
    const targetPath = targetUri.path.toLowerCase();

    for (const allowed of allowedUris) {
        if (allowed === '/') return true; // Global access

        let allowedUri: vscode.Uri;
        try {
            allowedUri = resolveUri(allowed);
        } catch {
            continue;
        }

        // 1. Scheme Check
        if (allowedUri.scheme.toLowerCase() !== targetScheme) continue;

        // 2. Authority Check
        if (allowedUri.authority.toLowerCase() !== targetAuth) continue;

        // 3. Path Inclusion Check
        let allowedPath = allowedUri.path.toLowerCase();
        
        // Exact match
        if (targetPath === allowedPath) return true;

        // Directory match: ensure allowedPath ends with '/' for prefix checking
        if (!allowedPath.endsWith('/')) {
            allowedPath += '/';
        }

        if (targetPath.startsWith(allowedPath)) return true;
    }

    return false;
}

/**
 * Get a unique key for the URI to use in Maps/Sets.
 * Using toString() ensures uniqueness across schemes.
 */
export function getUriKey(uri: vscode.Uri): string {
    return uri.toString();
}

const COMMON_IGNORED = new Set(['node_modules', '.git', '.vscode', 'dist', 'out', 'build', '__pycache__', 'coverage']);

export function isCommonIgnored(name: string): boolean {
    return name.startsWith('.') || COMMON_IGNORED.has(name);
}
