import { ITool, ToolContext } from './interface';
import { resolveUri, checkAccess } from './utils';
import { handleEdit } from './edit_file';
import * as vscode from 'vscode';
import { TextDecoder } from 'util';

export const editFileSearchReplaceTool: ITool = {
    name: 'edit_file_search_replace',
    definition: {
        type: 'function',
        function: {
            name: 'edit_file_search_replace',
            description: 'Replace a part of a file using SEARCH/REPLACE blocks. The format of a SEARCH/REPLACE block is below: \n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE',
            parameters: {
                type: 'object',
                properties: { 
                    uri: { type: 'string' }, 
                    search_replace: { type: 'string' } 
                },
                required: ['uri', 'search_replace']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        if (!args.uri || !args.search_replace) {
            return 'Error: Missing arguments (uri, search_replace).';
        }

        const uri = resolveUri(args.uri);
        if (!checkAccess(uri, context.allowedUris)) {
            return `Access Denied: Agent is not allowed to edit ${uri.toString()}`;
        }

        let originalContent = '';
        try {
            const bytes = await vscode.workspace.fs.readFile(uri);
            originalContent = new TextDecoder().decode(bytes);
        } catch (e: any) {
            return `Error reading file: ${e.message}`;
        }

        // Parse search/replace block
        const block = args.search_replace;
        const searchMarker = '<<<<<<< SEARCH';
        const midMarker = '=======';
        const endMarker = '>>>>>>> REPLACE';

        const searchStart = block.indexOf(searchMarker);
        const midStart = block.indexOf(midMarker);
        const endStart = block.indexOf(endMarker);

        if (searchStart === -1 || midStart === -1 || endStart === -1) {
            return 'Error: Invalid search_replace format. Use:\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE';
        }

        const searchContent = block.substring(searchStart + searchMarker.length, midStart).trim();
        const replaceContent = block.substring(midStart + midMarker.length, endStart).trim();

        // Attempt replacement with normalization
        let newContent = originalContent;
        
        if (!originalContent.includes(searchContent)) {
            // Try normalized version (handle different line endings)
            const normalize = (s: string) => s.replace(/\r\n/g, '\n');
            const normOrig = normalize(originalContent);
            const normSearch = normalize(searchContent);
            
            if (normOrig.includes(normSearch)) {
                newContent = normOrig.replace(normSearch, replaceContent);
            } else {
                return `Error: Could not find SEARCH block in file.\n\nSearch term:\n${searchContent}`;
            }
        } else {
            newContent = originalContent.replace(searchContent, replaceContent);
        }

        // Delegate to core edit handler
        return handleEdit(args.uri, newContent, context, 'edit_file_search_replace');
    }
};