import * as vscode from 'vscode';
import * as path from 'path';
const matter = require('gray-matter');
import { ITool, ToolContext } from '../tools.d/interface';
import { ContextAssembler } from './contextAssembler';
import { TextDecoder, TextEncoder } from 'util';
import * as pp from 'preprocess';

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
            const newSkills = new Map<string, ITool>();
            
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                return;
            }
            const rootPath = workspaceFolders[0].uri.fsPath;
            const rootUri = workspaceFolders[0].uri;

            const skillDirUri = vscode.Uri.joinPath(rootUri, this.skillDir);
            const cacheDirUri = vscode.Uri.joinPath(rootUri, this.cacheDir);

            try {
                await vscode.workspace.fs.stat(skillDirUri);
            } catch {
                return; 
            }

            try {
                await vscode.workspace.fs.stat(cacheDirUri);
            } catch {
                await vscode.workspace.fs.createDirectory(cacheDirUri);
            }

            const entries = await vscode.workspace.fs.readDirectory(skillDirUri);
            
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.skill.md')) {
                    await this.processSkillFile(name, skillDirUri, cacheDirUri, rootUri, newSkills);
                }
            }
            
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

        await this.loadSkills();
    }

    private async processSkillFile(
        filename: string, 
        skillDirUri: vscode.Uri, 
        cacheDirUri: vscode.Uri, 
        rootUri: vscode.Uri,
        targetMap: Map<string, ITool>
    ) {
        const skillName = filename.replace('.skill.md', '');
        const cacheFileUri = vscode.Uri.joinPath(cacheDirUri, filename);
        const sourceFileUri = vscode.Uri.joinPath(skillDirUri, filename);
        
        let description = '';
        let params: string[] = [];

        try {
            // 1. Check if cache is valid
            let cacheValid = false;
            try {
                const cacheStat = await vscode.workspace.fs.stat(cacheFileUri);
                const sourceStat = await vscode.workspace.fs.stat(sourceFileUri);
                if (cacheStat.mtime > sourceStat.mtime) {
                    cacheValid = true;
                }
            } catch (e) {
                // Cache missing or stat failed
            }

            if (!cacheValid) {
                // Read source file to extract front matter
                const sourceBytes = await vscode.workspace.fs.readFile(sourceFileUri);
                const sourceContent = new TextDecoder().decode(sourceBytes);

                const parsed = matter(sourceContent);
                description = parsed.data?.Description || '';
                params = parsed.data?.Params || [];

                // Create cache file with front-matter and @[...] reference
                const cacheData = {
                    Description: description,
                    Params: params
                };
                
                // Cache content: front-matter + @[...]
                const cacheContent = `@[${sourceFileUri.toString()}]`;
                const cacheFileContent = matter.stringify(cacheContent, cacheData);
                
                await vscode.workspace.fs.writeFile(cacheFileUri, new TextEncoder().encode(cacheFileContent));
            } else {
                // Read from cache to get description and params
                const cacheContentBytes = await vscode.workspace.fs.readFile(cacheFileUri);
                const cacheContent = new TextDecoder().decode(cacheContentBytes);
                const parsed = matter(cacheContent);
                description = parsed.data?.Description || '';
                params = parsed.data?.Params || [];
            }

            // Register skill tool
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
            execute: async (args: any, contextData: ToolContext) => {
                try {
                    // 1. Read cache file, extract @[...] to get source file path
                    const bytes = await vscode.workspace.fs.readFile(cacheUri);
                    const cacheContent = new TextDecoder().decode(bytes);
                    const parsedCache = matter(cacheContent);
                    
                    // Extract source file URI from @[...] syntax
                    const contentBody = parsedCache.content.trim();
                    const match = contentBody.match(/@\[([^\]]+)\]/);
                    if (!match) {
                        throw new Error('Source file URI not found in cache');
                    }
                    const sourceFileUriStr = match[1];
                    const sourceFileUri = vscode.Uri.parse(sourceFileUriStr);

                    // 2. Read source file content, extract front matter
                    const sourceBytes = await vscode.workspace.fs.readFile(sourceFileUri);
                    const sourceContent = new TextDecoder().decode(sourceBytes);
                    const parsedSource = matter(sourceContent);
                    const body = parsedSource.content;

                    // 3. Build context object with parameters for preprocess library
                    const context: Record<string, any> = {};
                    for (const param of params) {
                        const val = args[param] !== undefined ? args[param] : '';
                        context[param] = String(val);
                    }

                    // 4. Call preprocess.preprocess(source, context, options)
                    const result = pp.preprocess(body, context, { type: 'js' });

                    // 5. Call ContextAssembler.assembleDocument(result) to resolve nested tools AND file references
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    const rootUri = workspaceFolders ? workspaceFolders[0].uri : vscode.Uri.file('/');
                    const allowedUris = workspaceFolders ? [workspaceFolders[0].uri.fsPath] : [];
                    
                    const finalResult = await ContextAssembler.assembleDocument(
                        result,
                        rootUri,
                        allowedUris,
                        undefined, // Default ParseMode.INLINE
                        undefined, // No collector
                        context    // Pass context for macros
                    );

                    return finalResult.trim();
                } catch (e: any) {
                    const msg = `Error executing skill ${name}: ${e.message}`;
                    this.log(msg);
                    return msg;
                }
            },
            prettyPrint: (_args: any) => {
                return `🔓 Mutsumi unlocked skill ${name}`;
            }
        };

        targetMap.set(name, tool);
    }

    public getTools(): ITool[] {
        return Array.from(this.skills.values());
    }
}
