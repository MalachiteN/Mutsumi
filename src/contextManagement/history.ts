import * as vscode from 'vscode';
import { AgentMessage, AgentMetadata, MessageContent, ContentPartImage, ContentPartText } from '../types';
import { getSystemPrompt } from './prompts';
import { ContextAssembler, ParseMode } from './contextAssembler';

/**
 * @description Build Agent's conversation history context
 * @param {vscode.NotebookDocument} notebook - Notebook document object
 * @param {number} currentCellIndex - Current cell index
 * @param {string} currentPrompt - Current user input prompt text
 * @returns {Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }>} Object containing message list, allowed URIs list, and sub-agent identifier
 * @example
 * const { messages, allowedUris, isSubAgent } = await buildInteractionHistory(notebook, 5, 'Hello');
 * // messages[0] is system prompt
 * // messages[messages.length-1] is current user input
 */
export async function buildInteractionHistory(
    notebook: vscode.NotebookDocument,
    currentCellIndex: number,
    currentPrompt: string
): Promise<{ messages: AgentMessage[], allowedUris: string[], isSubAgent: boolean }> {
    const messages: AgentMessage[] = [];
    
    // Get system prompt (dynamically built)
    const metadata = notebook.metadata as AgentMetadata;
    const allowedUris = metadata.allowed_uris || ['/'];
    const isSubAgent = !!metadata.parent_agent_id;

    // Get workspace folder URI
    const wsUri = vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders[0].uri : notebook.uri;
    
    let systemPromptContent = await getSystemPrompt(wsUri, allowedUris, isSubAgent);

    // Parse @[path] references in current prompt and append to system prompt
    const contextInjection = await ContextAssembler.resolveUserPromptReferences(currentPrompt, wsUri.fsPath, allowedUris);
    if (contextInjection) {
        systemPromptContent += "\n\n" + contextInjection;
    }

    messages.push({
        role: 'system',
        content: systemPromptContent
    });

    // Load history from previous cells
    for (let i = 0; i < currentCellIndex; i++) {
        const prevCell = notebook.cellAt(i);
        const role = prevCell.metadata?.role || 'user';
        
        const content = prevCell.document.getText();
        if (content.trim()) {
            if (role === 'user') {
                const multiModalContent = await parseUserMessageWithImages(content);
                messages.push({ role: 'user', content: multiModalContent });
            } else {
                // Assistant messages are typically plain text or tool calls
                messages.push({ role: role as any, content });
            }
        }

        if (prevCell.metadata?.mutsumi_interaction) {
            const interaction = prevCell.metadata.mutsumi_interaction as AgentMessage[];
            messages.push(...interaction);
        }
    }

    // Add current user prompt (parse images)
    const currentMultiModalContent = await parseUserMessageWithImages(currentPrompt);
    messages.push({ role: 'user', content: currentMultiModalContent });

    return { messages, allowedUris, isSubAgent };
}

/** Image regex: matches Markdown images in ![alt](uri) format */
const IMG_REGEX = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * @description Parse image references in user message, convert to multimodal content format
 * @private
 * @param {string} text - User input text
 * @returns {Promise<MessageContent>} Parsed content, returns content array if contains images, otherwise returns original text
 * @example
 * const content = await parseUserMessageWithImages('Hello ![screenshot](file:///path/to/img.png) world');
 * // Returns: [
 * //   { type: 'text', text: 'Hello ' },
 * //   { type: 'image_url', image_url: { url: 'data:image/png;base64,...', detail: 'auto' } },
 * //   { type: 'text', text: ' world' }
 * // ]
 */
async function parseUserMessageWithImages(text: string): Promise<MessageContent> {
    const matches = [...text.matchAll(IMG_REGEX)];
    
    if (matches.length === 0) {
        return text;
    }

    const content: (ContentPartText | ContentPartImage)[] = [];
    let lastIndex = 0;

    for (const match of matches) {
        const [fullMatch, altText, uriStr] = match;
        const index = match.index!;

        // Add text before image
        if (index > lastIndex) {
            content.push({
                type: 'text',
                text: text.substring(lastIndex, index)
            });
        }

        // Process image
        try {
            const imageBase64 = await readImageAsBase64(uriStr);
            if (imageBase64) {
                content.push({
                    type: 'image_url',
                    image_url: {
                        url: imageBase64,
                        detail: 'auto'
                    }
                });
            } else {
                // If read fails, preserve original Markdown
                content.push({ type: 'text', text: fullMatch });
            }
        } catch (e) {
            console.error(`Failed to read image ${uriStr}:`, e);
            content.push({ type: 'text', text: fullMatch });
        }

        lastIndex = index + fullMatch.length;
    }

    // Add remaining text
    if (lastIndex < text.length) {
        content.push({
            type: 'text',
            text: text.substring(lastIndex)
        });
    }

    return content;
}

/**
 * @description Read image file and convert to Base64 encoded data URL
 * @private
 * @param {string} uriStr - Image URI string
 * @returns {Promise<string | null>} Base64 encoded image data URL, returns null if read fails
 * @description Supports local files (file://) and web images (http/https)
 * @description Automatically infers MIME type from file extension
 * @example
 * const base64 = await readImageAsBase64('file:///path/to/image.png');
 * // Returns: 'data:image/png;base64,iVBORw0KGgo...'
 */
async function readImageAsBase64(uriStr: string): Promise<string | null> {
    try {
        const uri = vscode.Uri.parse(uriStr);
        // Only handle file protocol, and local files
        if (uri.scheme !== 'file') {
             // Web images not supported yet, unless LLM natively supports URLs
             if (uri.scheme === 'http' || uri.scheme === 'https') {
                 return uriStr; 
             }
             return null;
        }

        const bytes = await vscode.workspace.fs.readFile(uri);
        const buffer = Buffer.from(bytes);
        
        // Simple MIME type inference
        const ext = uriStr.split('.').pop()?.toLowerCase();
        let mimeType = 'image/jpeg';
        if (ext === 'png') mimeType = 'image/png';
        if (ext === 'webp') mimeType = 'image/webp';
        if (ext === 'gif') mimeType = 'image/gif';

        return `data:${mimeType};base64,${buffer.toString('base64')}`;

    } catch (e) {
        console.error('Error reading image file:', e);
        return null;
    }
}
