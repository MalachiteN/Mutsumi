import { ITool, ToolContext } from './interface';
import { resolveUri, requestApproval } from './utils';
import * as vscode from 'vscode';
import { CodebaseService } from '../codebase/service';

const MAX_FILES_TO_SCAN = 100;

export const projectOutlineTool: ITool = {
    name: 'project_outline',
    definition: {
        type: 'function',
        function: {
            name: 'project_outline',
            description: 'Generate a structural outline of the project source code. Uses Tree-sitter parsing to identify classes, functions, and methods.',
            parameters: {
                type: 'object',
                properties: {
                    uri: { type: 'string', description: 'The root directory URI to scan (optional).' }
                },
                required: ['uri']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        try {
            const { uri: uriInput } = args;
            const rootUri = resolveUri(uriInput);

            // 1. Approval
            const approved = await requestApproval(
                'Project Outline Scan',
                uriInput || 'Workspace',
                context,
                `Scans up to ${MAX_FILES_TO_SCAN} files for code structure using Tree-sitter.`
            );
            if (!approved) return 'User rejected the project outline scan.';

            // 2. Find Files
            const includePattern = new vscode.RelativePattern(rootUri, '**/*');
            const excludePattern = '**/*.d.ts'; 
            const files = await vscode.workspace.findFiles(includePattern, excludePattern, MAX_FILES_TO_SCAN);

            if (files.length === 0) return "No matching files found.";

            // 3. Process Files with CodebaseService
            const codebaseService = CodebaseService.getInstance();
            const outlinePromises = files.map(async (fileUri) => {
                try {
                    const nodes = await codebaseService.getFileOutline(fileUri);
                    if (nodes && nodes.length > 0) {
                        const relPath = vscode.workspace.asRelativePath(fileUri);
                        const treeStr = codebaseService.formatOutline(nodes);
                        return `File: ${relPath}\n${treeStr}`;
                    }
                } catch (e) {
                    // Ignore parse errors
                }
                return null;
            });

            const results = await Promise.all(outlinePromises);
            const validResults = results.filter(r => r !== null).sort();

            if (validResults.length === 0) return "No structure extracted from files. Ensure Tree-sitter WASM files are correctly installed.";

            const header = files.length >= MAX_FILES_TO_SCAN 
                ? `(Limit reached: showing first ${MAX_FILES_TO_SCAN} files)\n\n` 
                : '';

            return header + validResults.join('\n\n');

        } catch (err: any) {
            return `Error generating outline: ${err.message}`;
        }
    },
    prettyPrint: (args: any) => {
        return `🏗️ Mutsumi generated project outline for ${args.uri || '(unknown directory)'}`;
    }
};