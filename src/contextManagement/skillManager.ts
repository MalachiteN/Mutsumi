import * as vscode from 'vscode';
const matter = require('gray-matter');
import { ITool, ToolContext } from '../tools.d/interface';
import { TextDecoder } from 'util';
import { TemplateEngine } from './templateEngine';
import { debugLogger } from '../debugLogger';

interface SkillCacheEntry {
    metadata: { description: string; params: string[] };
    content: string;
    mtime: number;
    sourceUri: vscode.Uri;
}

export class SkillManager {
    private static instance: SkillManager;
    private skills: Map<string, ITool> = new Map();
    private skillCache: Map<string, SkillCacheEntry> = new Map();
    private skillDir = '.mutsumi/skills';
    private isLoading = false;
    private skillWatcher?: vscode.FileSystemWatcher;
    private pendingReload = false;

    public static getInstance(): SkillManager {
        if (!SkillManager.instance) {
            SkillManager.instance = new SkillManager();
        }
        return SkillManager.instance;
    }

    private constructor() {}

    private log(message: string) {
        debugLogger.log(`[Skills] ${message}`);
    }

    public registerSkillWatcher(context: vscode.ExtensionContext): void {
        if (this.skillWatcher) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const rootUri = workspaceFolders[0].uri;
        const pattern = new vscode.RelativePattern(rootUri, '.mutsumi/skills/*.skill.md');
        const watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.skillWatcher = watcher;

        const reload = () => {
            void this.recompileAllSkills().catch(error => {
                this.log(`Failed to reload skills after change: ${error}`);
            });
        };

        context.subscriptions.push(
            watcher,
            watcher.onDidCreate(reload),
            watcher.onDidChange(reload),
            watcher.onDidDelete(reload)
        );
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
            const rootUri = workspaceFolders[0].uri;

            const skillDirUri = vscode.Uri.joinPath(rootUri, this.skillDir);

            try {
                await vscode.workspace.fs.stat(skillDirUri);
            } catch {
                return; 
            }

            const entries = await vscode.workspace.fs.readDirectory(skillDirUri);
            
            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name.endsWith('.skill.md')) {
                    await this.processSkillFile(name, skillDirUri, newSkills);
                }
            }
            
            this.skills = newSkills;
            this.log(`Loaded ${this.skills.size} skills.`);

        } catch (error) {
            this.log(`Fatal error in loadSkills: ${error}`);
            console.error('Error loading skills:', error);
        } finally {
            this.isLoading = false;
            if (this.pendingReload) {
                this.pendingReload = false;
                await this.recompileAllSkills();
            }
        }
    }

    public async recompileAllSkills(): Promise<void> {
        if (this.isLoading) {
            this.pendingReload = true;
            return;
        }

        this.skillCache.clear();
        await this.loadSkills();
    }

    private async processSkillFile(
        filename: string, 
        skillDirUri: vscode.Uri, 
        targetMap: Map<string, ITool>
    ) {
        const skillName = filename.replace('.skill.md', '');
        const sourceFileUri = vscode.Uri.joinPath(skillDirUri, filename);
        
        try {
            // Read source file to extract front matter
            const sourceBytes = await vscode.workspace.fs.readFile(sourceFileUri);
            const sourceContent = new TextDecoder().decode(sourceBytes);
            const sourceStat = await vscode.workspace.fs.stat(sourceFileUri);

            const parsed = matter(sourceContent);
            const description = parsed.data?.Description || '';
            const params = parsed.data?.Params || [];
            const body = parsed.content;

            // Store in memory cache
            this.skillCache.set(skillName, {
                metadata: { description, params },
                content: body,
                mtime: sourceStat.mtime,
                sourceUri: sourceFileUri
            });

            // Register skill tool
            this.registerSkillTool(skillName, description, params, targetMap);

        } catch (e) {
            this.log(`Failed to process skill ${filename}: ${e}`);
        }
    }

    private registerSkillTool(
        name: string, 
        description: string, 
        params: string[], 
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
                    // Check if we need to refresh the skill from source
                    const cached = this.skillCache.get(name);
                    if (!cached) {
                        throw new Error(`Skill ${name} not found in cache`);
                    }

                    // Check source file mtime
                    const sourceStat = await vscode.workspace.fs.stat(cached.sourceUri);
                    let currentContent = cached.content;
                    let currentParams = cached.metadata.params;
                    
                    if (sourceStat.mtime > cached.mtime) {
                        // Refresh from source
                        const sourceBytes = await vscode.workspace.fs.readFile(cached.sourceUri);
                        const sourceContent = new TextDecoder().decode(sourceBytes);
                        const parsed = matter(sourceContent);
                        
                        currentContent = parsed.content;
                        currentParams = parsed.data?.Params || [];
                        
                        // Update cache
                        this.skillCache.set(name, {
                            ...cached,
                            content: currentContent,
                            metadata: {
                                ...cached.metadata,
                                params: currentParams
                            },
                            mtime: sourceStat.mtime
                        });
                    }

                    // Use TemplateEngine to render the skill content
                    const workspaceFolders = vscode.workspace.workspaceFolders;
                    let rootUri: vscode.Uri;
                    if (workspaceFolders && workspaceFolders.length > 0) {
                        rootUri = workspaceFolders[0].uri;
                    } else {
                        // Fallback: use the first allowed URI if available, otherwise use filesystem root
                        const allowedUris = contextData.allowedUris || [];
                        if (allowedUris.length > 0) {
                            try {
                                rootUri = vscode.Uri.parse(allowedUris[0]);
                            } catch {
                                rootUri = vscode.Uri.file('/');
                            }
                        } else {
                            rootUri = vscode.Uri.file('/');
                        }
                    }
                    
                    const allowedUris = contextData.allowedUris || ['/'];
                    
                    const { renderedText } = await TemplateEngine.render(
                        currentContent,
                        args,
                        rootUri,
                        allowedUris,
                        'INLINE'
                    );

                    return renderedText.trim();
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
