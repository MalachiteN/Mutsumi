/**
 * @fileoverview Skill Manager for discovering and managing SKILL.md files.
 * @module contextManagement/skillManager
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
const matter = require('gray-matter');
import { TextDecoder } from 'util';

/**
 * Metadata for a discovered skill
 */
export interface SkillMetadata {
    /** Skill name from front-matter */
    name: string;
    /** Skill description from front-matter */
    description: string;
    /** URI to the SKILL.md file */
    uri: vscode.Uri;
}

/**
 * Skill Manager - Singleton class for managing skills discovery and monitoring
 */
export class SkillManager {
    private static instance: SkillManager | null = null;
    private skills: SkillMetadata[] = [];
    private disposables: vscode.Disposable[] = [];
    private watchers: vscode.FileSystemWatcher[] = [];

    /**
     * Private constructor to enforce singleton pattern
     */
    private constructor() {}

    /**
     * Get the singleton instance of SkillManager
     * @returns The SkillManager instance
     */
    public static getInstance(): SkillManager {
        if (!SkillManager.instance) {
            SkillManager.instance = new SkillManager();
        }
        return SkillManager.instance;
    }

    /**
     * Get all discovered skills
     * @returns Readonly array of skill metadata
     */
    public get skillsList(): ReadonlyArray<SkillMetadata> {
        return Object.freeze([...this.skills]);
    }

    /**
     * Initialize the skill manager - discover all skills and start watching
     * @param context - Extension context for registering disposables
     */
    public async initialize(context: vscode.ExtensionContext): Promise<void> {
        // Initial discovery
        await this.discoverAllSkills();

        // Setup file watchers
        this.setupWatchers();

        // Register disposables
        this.disposables.forEach(d => context.subscriptions.push(d));
        this.watchers.forEach(w => context.subscriptions.push(w));
    }

    /**
     * Discover skills from all sources (workspace folders and user home)
     * Skills from earlier workspace folders have higher priority than later ones.
     * User home skills have the lowest priority.
     */
    private async discoverAllSkills(): Promise<void> {
        const skillMap = new Map<string, SkillMetadata>();

        // Helper to insert skills with name-based deduplication (first wins)
        const insertSkills = (skills: SkillMetadata[]) => {
            for (const skill of skills) {
                if (!skillMap.has(skill.name)) {
                    skillMap.set(skill.name, skill);
                }
            }
        };

        // Discover from workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const skills = await this.discoverSkillsFromDirectory(folder.uri);
                insertSkills(skills);
            }
        }

        // Discover from user home directory
        const userHomeSkills = await this.discoverSkillsFromUserHome();
        insertSkills(userHomeSkills);

        this.skills = Array.from(skillMap.values());
    }

    /**
     * Discover skills from user home directory (~/.agents/skills/)
     */
    private async discoverSkillsFromUserHome(): Promise<SkillMetadata[]> {
        const homeDir = os.homedir();
        const homeUri = vscode.Uri.file(homeDir);
        return this.discoverSkillsFromDirectory(homeUri);
    }

    /**
     * Discover skills from a specific directory (baseDir/.agents/skills/)
     * @param baseUri - Base directory URI to search from
     */
    private async discoverSkillsFromDirectory(baseUri: vscode.Uri): Promise<SkillMetadata[]> {
        const skillsDir = vscode.Uri.joinPath(baseUri, '.agents', 'skills');
        const skills: SkillMetadata[] = [];

        try {
            // Check if skills directory exists
            await vscode.workspace.fs.stat(skillsDir);

            // Read all subdirectories
            const entries = await vscode.workspace.fs.readDirectory(skillsDir);

            for (const [name, type] of entries) {
                if (type === vscode.FileType.Directory) {
                    const skillFileUri = vscode.Uri.joinPath(skillsDir, name, 'SKILL.md');
                    const skill = await this.parseSkillFile(skillFileUri);
                    if (skill) {
                        skills.push(skill);
                    }
                }
            }
        } catch {
            // Directory doesn't exist or error reading, return empty array
        }

        return skills;
    }

    /**
     * Parse a SKILL.md file and extract metadata
     * @param skillFileUri - URI to the SKILL.md file
     * @returns SkillMetadata if valid, null otherwise
     */
    private async parseSkillFile(skillFileUri: vscode.Uri): Promise<SkillMetadata | null> {
        try {
            const content = await vscode.workspace.fs.readFile(skillFileUri);
            const decodedContent = new TextDecoder().decode(content);

            // Parse front-matter using gray-matter
            const parsed = matter(decodedContent);
            const data = parsed.data || {};

            // Extract required fields, discard others
            const name = data.name;
            const description = data.description;

            // Validate required fields
            if (typeof name !== 'string' || !name.trim()) {
                return null;
            }
            if (typeof description !== 'string' || !description.trim()) {
                return null;
            }

            return {
                name: name.trim(),
                description: description.trim(),
                uri: skillFileUri
            };
        } catch {
            // File doesn't exist or parse error
            return null;
        }
    }

    /**
     * Setup file system watchers for all workspace skill directories
     */
    private setupWatchers(): void {
        // Clear existing watchers
        this.watchers.forEach(w => w.dispose());
        this.watchers = [];

        // Watch workspace folders
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders) {
            for (const folder of workspaceFolders) {
                const pattern = new vscode.RelativePattern(
                    folder,
                    '.agents/skills/*/SKILL.md'
                );
                const watcher = vscode.workspace.createFileSystemWatcher(pattern);

                watcher.onDidCreate(uri => this.handleSkillFileCreated(uri));
                watcher.onDidChange(uri => this.handleSkillFileChanged(uri));
                watcher.onDidDelete(uri => this.handleSkillFileDeleted(uri));

                this.watchers.push(watcher);
            }
        }

        // Watch user home directory
        const homeDir = os.homedir();
        const homeUri = vscode.Uri.file(homeDir);
        const homePattern = new vscode.RelativePattern(
            homeUri,
            '.agents/skills/*/SKILL.md'
        );
        const homeWatcher = vscode.workspace.createFileSystemWatcher(homePattern);

        homeWatcher.onDidCreate(uri => this.handleSkillFileCreated(uri));
        homeWatcher.onDidChange(uri => this.handleSkillFileChanged(uri));
        homeWatcher.onDidDelete(uri => this.handleSkillFileDeleted(uri));

        this.watchers.push(homeWatcher);
    }

    /**
     * Handle new SKILL.md file creation
     */
    private async handleSkillFileCreated(uri: vscode.Uri): Promise<void> {
        const skill = await this.parseSkillFile(uri);
        if (skill) {
            // Remove existing skill with same URI if exists
            this.skills = this.skills.filter(s => s.uri.toString() !== skill.uri.toString());
            this.skills.push(skill);
        }
    }

    /**
     * Handle SKILL.md file modification
     */
    private async handleSkillFileChanged(uri: vscode.Uri): Promise<void> {
        const skill = await this.parseSkillFile(uri);
        const uriString = uri.toString();
        const existingIndex = this.skills.findIndex(s => s.uri.toString() === uriString);

        if (skill) {
            if (existingIndex >= 0) {
                // Update existing
                this.skills[existingIndex] = skill;
            } else {
                // Add new
                this.skills.push(skill);
            }
        } else if (existingIndex >= 0) {
            // Invalid skill after change, remove it
            this.skills.splice(existingIndex, 1);
        }
    }

    /**
     * Handle SKILL.md file deletion
     */
    private handleSkillFileDeleted(uri: vscode.Uri): void {
        const uriString = uri.toString();
        this.skills = this.skills.filter(s => s.uri.toString() !== uriString);
    }

    /**
     * Dispose all resources
     */
    public dispose(): void {
        this.watchers.forEach(w => w.dispose());
        this.watchers = [];
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
        SkillManager.instance = null;
    }

    /**
     * Force refresh all skills (useful for manual refresh)
     */
    public async refresh(): Promise<void> {
        await this.discoverAllSkills();
    }

    /**
     * Generate a Markdown JSON code block containing only active skills.
     * This can be stored in AgentMetadata.activeSkills to persist skill selections.
     * 
     * Only skills whose name is in activeSkillNames will be included in the output.
     * Each skill will have name, description, and uri fields.
     * 
     * @param activeSkillNames - Optional array of skill names that are active.
     *                           If undefined or empty, returns empty array.
     * @returns Markdown string with JSON code block containing active skills info
     * @example
     * When a skill from the Installed Skills list may be applicable to the current scenario:
     * 1. Immediately read_file the skill's SKILL.md file to determine if it is truly appropriate
     * 2. If it can indeed solve the problem, execute the task following the steps and tool usage described within
     * 3. Skill files may contain specific instructions, tool call specifications, or output format requirements
     * 
     * ```json
     * [
     *   {"name": "skill1", "description": "desc1", "uri": "file:///path/to/SKILL.md"},
     *   {"name": "skill2", "description": "desc2", "uri": "file:///path/to/SKILL.md"}
     * ]
     * ```
     */
    public generateSkillsMarkdown(activeSkillNames?: string[]): string {
        // Create a Set for O(1) lookup, default to empty set if undefined
        const activeSet = activeSkillNames ? new Set(activeSkillNames) : new Set<string>();

        // Filter only active skills and build output array with uri string
        const activeSkills = this.skills
            .filter(skill => activeSet.has(skill.name))
            .map(skill => ({
                name: skill.name,
                description: skill.description,
                uri: skill.uri.toString()
            }));

        // Build the instruction text
        const instructionText = `When a skill from the Installed Skills list may be applicable to the current scenario:
1. Immediately read_file the skill's SKILL.md file to determine if it is truly appropriate
2. If it can indeed solve the problem, execute the task following the steps and tool usage described within
3. Skill files may contain specific instructions, tool call specifications, or output format requirements`;

        // Serialize to JSON with indentation
        const jsonContent = JSON.stringify(activeSkills, null, 2);

        // Combine instruction and JSON code block
        return instructionText + '\n\n```json\n' + jsonContent + '\n```';
    }
}
