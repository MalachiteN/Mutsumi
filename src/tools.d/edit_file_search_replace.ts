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
            description: 'Replace parts of a file using one or more SEARCH/REPLACE blocks. Multiple blocks are supported and will be applied in order. The format of each SEARCH/REPLACE block is below: \n<<<<<<<SEARCH\n...\n=======\n...\n>>>>>>>REPLACE\n\nMultiple blocks example:\n<<<<<<<SEARCH\noldText1\n=======\nnewText1\n>>>>>>>REPLACE\n\n<<<<<<<SEARCH\noldText2\n=======\nnewText2\n>>>>>>>REPLACE',
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

        // Parse and apply multiple search/replace blocks
        const searchMarker = '<<<<<<<SEARCH';
        const midMarker = '=======';
        const endMarker = '>>>>>>>REPLACE';

        const blocks: Array<{ search: string; replace: string }> = [];
        let currentPos = 0;
        const blockContent = args.search_replace;

        // Parse all blocks
        while (currentPos < blockContent.length) {
            const searchStart = blockContent.indexOf(searchMarker, currentPos);
            if (searchStart === -1) {
                break;
            }

            const midStart = blockContent.indexOf(midMarker, searchStart);
            if (midStart === -1) {
                return 'Error: Invalid search_replace format. Missing ======= marker.';
            }

            const endStart = blockContent.indexOf(endMarker, midStart);
            if (endStart === -1) {
                return 'Error: Invalid search_replace format. Missing >>>>>>>REPLACE marker.';
            }

            const searchContent = blockContent.substring(searchStart + searchMarker.length, midStart).trim();
            const replaceContent = blockContent.substring(midStart + midMarker.length, endStart).trim();

            if (searchContent === '') {
                return 'Error: SEARCH block cannot be empty.';
            }

            blocks.push({ search: searchContent, replace: replaceContent });
            currentPos = endStart + endMarker.length;
        }

        if (blocks.length === 0) {
            return 'Error: No valid SEARCH/REPLACE blocks found. Use:\n<<<<<<<SEARCH\n...\n=======\n...\n>>>>>>>REPLACE';
        }

        // Apply all replacements in order
        let newContent = originalContent;
        const normalize = (s: string) => s.replace(/\r\n/g, '\n');
        let appliedCount = 0;
        let errors: string[] = [];

        for (const block of blocks) {
            const { search, replace } = block;
            
            if (newContent.includes(search)) {
                newContent = newContent.replace(search, replace);
                appliedCount++;
            } else {
                // Try normalized version (handle different line endings)
                const normContent = normalize(newContent);
                const normSearch = normalize(search);
                
                if (normContent.includes(normSearch)) {
                    newContent = normContent.replace(normSearch, replace);
                    appliedCount++;
                } else {
                    errors.push(`Could not find SEARCH block:\n${search.substring(0, 200)}${search.length > 200 ? '...' : ''}`);
                }
            }
        }

        // Report errors if any block failed
        if (errors.length > 0) {
            const errorMsg = `Error: ${errors.length} block(s) could not be applied:\n\n${errors.join('\n\n')}`;
            if (appliedCount === 0) {
                return errorMsg;
            }
            // Partial success - return error but don't proceed with edit
            return `${errorMsg}\n\n(Only ${appliedCount} of ${blocks.length} blocks were applied)`;
        }

        // Delegate to core edit handler
        return handleEdit(args.uri, newContent, context, 'edit_file_search_replace');
    }
};
