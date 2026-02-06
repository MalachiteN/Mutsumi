import * as vscode from 'vscode';
import * as path from 'path';
import { ContextAssembler } from './assembler';

export class ContextResolver {

    /**
     * Resolves @[...] references in User Input text.
     * Supports:
     * 1. File references: @[path/to/file]
     *    - If .txt or .md, content is recursively assembled using &[] logic.
     * 2. Tool calls: @[toolName{args}]
     *    - Executed immediately.
     */
    static async resolveReferencesInText(text: string, workspaceRoot: string, allowedUris: string[]): Promise<string> {
        let resultText = "### User Provided Context References:\n\n";
        let hasRefs = false;
        let currentIndex = 0;
        
        while (currentIndex < text.length) {
            const startIdx = text.indexOf('@[', currentIndex);
            if (startIdx === -1) break;

            const { content, endIdx } = ContextAssembler.extractBracketContent(text, startIdx + 2);
            if (endIdx === -1) {
                currentIndex = startIdx + 2;
                continue;
            }

            hasRefs = true;
            currentIndex = endIdx + 1;

            const braceStart = content.indexOf('{');
            const braceEnd = content.lastIndexOf('}');
            const isTool = braceStart !== -1 && braceEnd !== -1 && braceStart < braceEnd;
            
            if (isTool) {
                // @[tool{...}]
                const toolName = content.substring(0, braceStart).trim();
                const jsonArgs = content.substring(braceStart, braceEnd + 1);
                
                try {
                    const args = JSON.parse(jsonArgs);
                    const toolOutput = await ContextAssembler.executeToolCall(toolName, args, allowedUris);
                    resultText += `#### Tool Call: ${toolName}\n> Args: ${jsonArgs}\n\n${toolOutput}\n\n`;
                } catch (e: any) {
                    resultText += `#### Tool Call: ${toolName}\n> Error: ${e.message}\n\n`;
                }
            } else {
                // @[path]
                try {
                    const { uri, startLine, endLine } = ContextAssembler.parseReference(content, workspaceRoot);
                    const fileContent = await ContextAssembler.readResource(uri, startLine, endLine);
                    
                    // Check extension for recursive parsing
                    const ext = path.extname(uri.fsPath).toLowerCase();
                    let finalContent = fileContent;
                    
                    if (ext === '.md' || ext === '.txt') {
                        finalContent = await ContextAssembler.assembleDocument(fileContent, workspaceRoot, allowedUris);
                    }
                    
                    resultText += `#### Source: ${content}\n\`\`\`\n${finalContent}\n\`\`\`\n\n`;
                } catch (e: any) {
                    resultText += `#### Source: ${content}\n> Error reading reference: ${e.message}\n\n`;
                }
            }
        }

        return hasRefs ? resultText : '';
    }
}
