import { ITool, ToolContext } from './interface';
import { handleEdit } from './edit_file'

export const editFileFullReplaceTool: ITool = {
    name: 'edit_file_full_replace',
    definition: {
        type: 'function',
        function: {
            name: 'edit_file_full_replace',
            description: 'Replace the full content of a file. Shows a diff view to the user for confirmation.',
            parameters: {
                type: 'object',
                properties: { 
                    uri: { type: 'string' }, 
                    new_content: { type: 'string' } 
                },
                required: ['uri', 'new_content']
            }
        }
    },
    execute: async (args: any, context: ToolContext) => {
        if (!args.uri || args.new_content === undefined) {
            return 'Error: Missing arguments (uri, new_content).';
        }
        return handleEdit(args.uri, args.new_content, context);
    }
};