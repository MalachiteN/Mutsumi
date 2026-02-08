import * as vscode from 'vscode';
import * as path from 'path';
// Use require to ensure we get the function correctly in CommonJS env without esModuleInterop
const matter = require('gray-matter'); 
import { ITool, ToolContext } from './tools.d/interface';
import { ContextAssembler, ParseMode } from './contextManagement/contextAssembler';
import { Preprocessor } from './contextManagement/preprocessor';
import { TextDecoder, TextEncoder } from 'util';

export class SkillManager {
    private static instance: SkillManager;
    private skills: Map<string, ITool> = new Map();
    private skillDir = '.mutsumi/skills';
    private cacheDir = '.mutsumi/skills/cache';
    private outputChannel: vscode.OutputChannel;
    private isLoading = false;

    public static getInstance(): SkillManager {
        if (!SkillManager.instance) {
            SkillManager.instance = new SkillManager();
        }
        return SkillManager.instance;
    }

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('Mutsumi Skills');
    }

    private log(message: string) {
        this.outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${message}`);
    }

    public async loadSkills(): Promise<void> {
        if (this.isLoading) {
            return;
        }

        this.isLoading = true;
        
        try {
            // Temporary map to hold new skills, swap at the end to minimize downtime
            const newSkills = new Map<string, ITool>();
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            const rootPath = workspaceFolders[0].uri.fsPath;
            const rootUri = workspaceFolders[0].uri;

            // Use Uri.joinPath for better cross-platform compatibility
            const skillDirUri = vscode.Uri.joinPath(rootUri, this.skillDir);
            const cacheDirUri = vscode.Uri.joinPath(rootUri, this.cacheDir);

            // Check if skill directory exists
            try {
                await vscode.workspace.fs.stat(skillDirUri);
            } catch {
                return; 
            }

            // Ensure cache directory exists
            try {
                await vscode.workspace.fs.stat(cacheDirUri);
            } catch {
                await vscode.workspace.fs.createDirectory(cacheDirUri);
            }

            const entries = await vscode.workspace.fs.readDirectory(skillDirUri);
            
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.skill.md')) {
                    await this.processSkillFile(name, skillDirUri, cacheDirUri, rootPath, newSkills);
                }
            }
            
            // Swap
            this.skills = newSkills;
            this.log(`Loaded ${this.skills.size} skills.`);

        } catch (error) {
            this.log(`Fatal error in loadSkills: ${error}`);
            console.error('Error loading skills:', error);
        } finally {
            this.isLoading = false;
        }
    }

    public async recompileAllSkills(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder found.');
        }

        const rootUri = workspaceFolders[0].uri;
        const cacheDirUri = vscode.Uri.joinPath(rootUri, this.cacheDir);

        // Clear cache directory
        try {
            const entries = await vscode.workspace.fs.readDirectory(cacheDirUri);
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File) {
                    await vscode.workspace.fs.delete(vscode.Uri.joinPath(cacheDirUri, name));
                }
            }
        } catch {
            // Cache directory may not exist
        }

        // Reload all skills (will recompile since cache is cleared)
        await this.loadSkills();
    }

    private async processSkillFile(
        filename: string, 
        skillDirUri: vscode.Uri, 
        cacheDirUri: vscode.Uri, 
        rootPath: string,
        targetMap: Map<string, ITool>
    ) {
        const skillName = filename.replace('.skill.md', '');
        const cacheFileUri = vscode.Uri.joinPath(cacheDirUri, filename);
        const sourceFileUri = vscode.Uri.joinPath(skillDirUri, filename);
        
        let description = '';
        let params: string[] = [];

        try {
            // 1. Check if cache is valid (exists and newer than source)
            let cacheValid = false;
            try {
                const cacheStat = await vscode.workspace.fs.stat(cacheFileUri);
                const sourceStat = await vscode.workspace.fs.stat(sourceFileUri);
                // Simple timestamp check
                if (cacheStat.mtime > sourceStat.mtime) {
                    cacheValid = true;
                }
            } catch (e) {
                // Cache missing or stat failed
            }

            if (cacheValid) {
                 try {
                     const cacheContentBytes = await vscode.workspace.fs.readFile(cacheFileUri);
                     const cacheContent = new TextDecoder().decode(cacheContentBytes);
                     const parsed = matter(cacheContent);
                     description = parsed.data.Description || '';
                     params = parsed.data.Params || [];
                 } catch (e) {
                     cacheValid = false;
                 }
            }

            if (!cacheValid) {
                const sourceBytes = await vscode.workspace.fs.readFile(sourceFileUri);
                const sourceContent = new TextDecoder().decode(sourceBytes);

                // Assuming references are relative to workspace root
                const prepared = await ContextAssembler.prepareSkill(
                    sourceContent,
                    rootPath,
                    [rootPath], // Allowed URIs
                    ParseMode.INLINE
                );

                description = prepared.description;
                params = prepared.params;

                // Step 3: Assemble cache file
                const cacheData = {
                    Description: description,
                    Params: params
                };
                
                // Trim content to prevent leading/trailing empty lines from accumulating
                const trimmedContent = prepared.content.trim();
                
                // Using matter.stringify to create content with front matter
                const cacheFileContent = matter.stringify(trimmedContent, cacheData);
                
                await vscode.workspace.fs.writeFile(cacheFileUri, new TextEncoder().encode(cacheFileContent));
            }

            // Step 5: Register tool
            this.registerSkillTool(skillName, description, params, cacheFileUri, targetMap);

        } catch (e) {
            this.log(`Failed to process skill ${filename}: ${e}`);
        }
    }

    private registerSkillTool(
        name: string, 
        description: string, 
        params: string[], 
        cacheUri: vscode.Uri,
        targetMap: Map<string, ITool>
    ) {
        const properties: Record<string, any> = {};
        params.forEach(p => {
            properties[p] = { type: 'string' };
        });

        const tool: ITool = {
            name: name,
            definition: {
                type: 'function',
                function: {
                    name: name,
                    description: description,
                    parameters: {
                        type: 'object',
                        properties: properties,
                        required: params
                    }
                }
            },
            execute: async (args: any, context: ToolContext) => {
                try {
                    // 1. Read cache file
                    const bytes = await vscode.workspace.fs.readFile(cacheUri);
                    const content = new TextDecoder().decode(bytes);
                    
                    // remove front matter
                    const parsed = matter(content);
                    // Trim to remove leading/trailing newlines that gray-matter may leave
                    const body = parsed.content.trim();

                    // 2. Prepend defines
                    let defines = '';
                    for (const param of params) {
                        const val = args[param] !== undefined ? args[param] : '';
                        // Simple escaping: replace " with \" to avoid breaking the define syntax
                        const escapedVal = String(val).replace(/"/g, '\\"');
                        defines += `@{define ${param}, "${escapedVal}"}\n`;
                    }
                    
                    const textToProcess = defines + body;

                    // 3. Preprocess
                    const preprocessor = new Preprocessor();
                    const { result, warnings } = preprocessor.process(textToProcess);

                    if (warnings.length > 0) {
                        this.log(`Skill ${name} warnings: ${warnings.join(', ')}`);
                    }

                    // 4. Return (trim to remove any leading/trailing newlines from defines or matter parsing)
                    return result.trim();
                } catch (e: any) {
                    const msg = `Error executing skill ${name}: ${e.message}`;
                    this.log(msg);
                    return msg;
                }
            }
        };

        targetMap.set(name, tool);
    }

    public getTools(): ITool[] {
        return Array.from(this.skills.values());
    }
}
