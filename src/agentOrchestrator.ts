/**
 * @fileoverview Orchestrates agent lifecycle, fork sessions, and UI state management.
 * @module agentOrchestrator
 */

import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AgentSidebarProvider } from './sidebar/agentSidebar';
import { AgentController } from './controller';
import { AgentStateInfo, AgentRuntimeStatus } from './types';

/**
 * Represents an active fork session with its state and callbacks.
 * @interface ForkSession
 */
interface ForkSession {
    /** Parent agent ID that initiated the fork */
    parentId: string;
    /** Resolve callback for the fork promise */
    resolve: (value: string | PromiseLike<string>) => void;
    /** Reject callback for the fork promise */
    reject: (reason?: any) => void;
    /** Set of child agent UUIDs in this session */
    childUuids: Set<string>;
    /** Map of child UUID to their result reports */
    results: Map<string, string>;
    /** Set of child UUIDs that were deleted */
    deletedChildren: Set<string>;
}

/**
 * Orchestrates agent lifecycle, state management, and fork operations.
 * @description Manages the global agent registry, handles fork sessions for sub-agents,
 * and coordinates UI updates through the sidebar provider.
 * @class AgentOrchestrator
 * @example
 * const orchestrator = AgentOrchestrator.getInstance();
 * orchestrator.setSidebar(sidebarProvider);
 * await orchestrator.requestFork(parentId, summary, subAgents);
 */
export class AgentOrchestrator {
    /** Singleton instance */
    private static instance: AgentOrchestrator;
    /** Sidebar provider for UI updates */
    private sidebar?: AgentSidebarProvider;
    /** Agent controller reference */
    private agentController?: AgentController;
    /** Notebook controller reference */
    private notebookController?: vscode.NotebookController;
    
    /** Global agent state registry (UUID -> Info) */
    private agentRegistry = new Map<string, AgentStateInfo>();
    
    /** Active fork sessions (ParentUUID -> Session) */
    private activeForks = new Map<string, ForkSession>();

    /**
     * Private constructor to enforce singleton pattern.
     * @private
     * @constructor
     */
    private constructor() {}

    /**
     * Gets the singleton instance of AgentOrchestrator.
     * @static
     * @returns {AgentOrchestrator} The singleton instance
     * @example
     * const orchestrator = AgentOrchestrator.getInstance();
     */
    public static getInstance(): AgentOrchestrator {
        if (!AgentOrchestrator.instance) {
            AgentOrchestrator.instance = new AgentOrchestrator();
        }
        return AgentOrchestrator.instance;
    }

    /**
     * Sets the sidebar provider for UI updates.
     * @param {AgentSidebarProvider} sidebar - The sidebar provider instance
     * @example
     * orchestrator.setSidebar(sidebarProvider);
     */
    public setSidebar(sidebar: AgentSidebarProvider): void {
        this.sidebar = sidebar;
    }

    /**
     * Registers the agent and notebook controllers.
     * @param {AgentController} agentController - The agent controller
     * @param {vscode.NotebookController} notebookController - The notebook controller
     * @example
     * orchestrator.registerController(agentController, notebookController);
     */
    public registerController(
        agentController: AgentController, 
        notebookController: vscode.NotebookController
    ): void {
        this.agentController = agentController;
        this.notebookController = notebookController;
    }

    /**
     * Gets the root agent ID of a tree by traversing parent pointers.
     * @private
     * @param {string} uuid - Agent UUID to find root for
     * @returns {string} The root agent UUID
     */
    private getRootId(uuid: string): string {
        const visited = new Set<string>();
        let current = uuid;
        
        while (true) {
            if (visited.has(current)) {
                // Circular reference detected, break the loop
                return current;
            }
            visited.add(current);
            
            const agent = this.agentRegistry.get(current);
            if (!agent || !agent.parentId) {
                return current;
            }
            current = agent.parentId;
        }
    }

    /**
     * Checks if any agent in the tree has an open window.
     * @private
     * @param {string} rootId - Root agent UUID of the tree
     * @returns {boolean} True if any window in the tree is open
     */
    private hasAnyWindowOpenInTree(rootId: string): boolean {
        const visited = new Set<string>();
        
        const checkNode = (uuid: string): boolean => {
            if (visited.has(uuid)) return false;
            visited.add(uuid);
            
            const agent = this.agentRegistry.get(uuid);
            if (!agent) return false;
            
            if (agent.isWindowOpen) return true;
            
            // Check children
            if (agent.childIds) {
                for (const childId of agent.childIds) {
                    if (checkNode(childId)) return true;
                }
            }
            
            return false;
        };
        
        return checkNode(rootId);
    }

    /**
     * Loads an agent from file if it exists.
     * @private
     * @param {string} uuid - Agent UUID to load
     * @returns {Promise<AgentStateInfo | undefined>} The loaded agent info or undefined
     */
    private async loadAgentFromFile(uuid: string): Promise<AgentStateInfo | undefined> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
        if (!workspaceRoot) return undefined;

        const fileUri = workspaceRoot.with({
            path: path.posix.join(workspaceRoot.path, '.mutsumi', `${uuid}.mtm`),
        });

        try {
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content));
            
            const agent: AgentStateInfo = {
                uuid,
                parentId: data.metadata?.parent_agent_id || null,
                name: data.metadata?.name || 'Unknown Agent',
                fileUri: fileUri.toString(),
                isWindowOpen: false,
                isRunning: false,
                isTaskFinished: !!data.metadata?.is_task_finished,
                childIds: new Set(data.metadata?.sub_agents_list || [])
            };
            
            this.agentRegistry.set(uuid, agent);
            return agent;
        } catch {
            return undefined;
        }
    }

    /**
     * Recursively loads all agents in a tree starting from a root.
     * @private
     * @param {string} uuid - Root agent UUID to start loading from
     * @param {Set<string>} visited - Set of already visited UUIDs to prevent cycles
     * @returns {Promise<void>}
     */
    private async loadAgentTree(uuid: string, visited: Set<string> = new Set()): Promise<void> {
        if (visited.has(uuid)) return;
        visited.add(uuid);
        
        // Get or load the agent
        let agent = this.agentRegistry.get(uuid);
        if (!agent) {
            agent = await this.loadAgentFromFile(uuid);
        }
        
        if (!agent) return;
        
        // Clean up invalid parent reference
        if (agent.parentId) {
            const parent = this.agentRegistry.get(agent.parentId);
            if (!parent) {
                // Parent doesn't exist in registry, check if file exists
                const parentFromFile = await this.loadAgentFromFile(agent.parentId);
                if (!parentFromFile) {
                    // Parent truly doesn't exist, make this agent independent
                    agent.parentId = null;
                    // Update file to reflect this change
                    await this.updateAgentParentInFile(uuid, null);
                }
            }
        }
        
        // Clean up invalid child references and recursively load children
        if (agent.childIds) {
            const validChildren = new Set<string>();
            for (const childId of agent.childIds) {
                let child = this.agentRegistry.get(childId);
                if (!child) {
                    child = await this.loadAgentFromFile(childId);
                }
                
                if (child) {
                    validChildren.add(childId);
                    // Recursively load this child's subtree
                    await this.loadAgentTree(childId, visited);
                }
            }
            agent.childIds = validChildren;
        }
    }

    /**
     * Updates the parent reference of an agent in its file.
     * @private
     * @param {string} uuid - Agent UUID to update
     * @param {string | null} newParentId - New parent ID or null
     * @returns {Promise<void>}
     */
    private async updateAgentParentInFile(uuid: string, newParentId: string | null): Promise<void> {
        const agent = this.agentRegistry.get(uuid);
        if (!agent) return;
        
        try {
            const fileUri = vscode.Uri.parse(agent.fileUri);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content));
            
            data.metadata.parent_agent_id = newParentId;
            
            const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
            await vscode.workspace.fs.writeFile(fileUri, encoded);
        } catch (e) {
            console.error('Failed to update agent parent in file:', e);
        }
    }

    /**
     * Updates the sub_agents_list of a parent agent in its file.
     * @private
     * @param {string} parentUuid - Parent agent UUID
     * @returns {Promise<void>}
     */
    private async updateParentSubAgentsList(parentUuid: string): Promise<void> {
        const parent = this.agentRegistry.get(parentUuid);
        if (!parent) return;
        
        try {
            const fileUri = vscode.Uri.parse(parent.fileUri);
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content));
            
            data.metadata.sub_agents_list = Array.from(parent.childIds || []);
            
            const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
            await vscode.workspace.fs.writeFile(fileUri, encoded);
        } catch (e) {
            console.error('Failed to update parent sub_agents_list:', e);
        }
    }

    /**
     * Computes and returns nodes for TreeView display.
     * @description Shows the entire tree if any node in the tree has an open window.
     * Only hides the tree when all nodes' windows are closed.
     * @returns {AgentStateInfo[]} Array of agent nodes to display
     * @example
     * const nodes = orchestrator.getAgentTreeNodes();
     * // Returns all agents in trees where at least one window is open
     */
    public getAgentTreeNodes(): AgentStateInfo[] {
        const nodes: AgentStateInfo[] = [];
        const rootIdsWithOpenWindow = new Set<string>();
        
        // First pass: find all root IDs that have at least one window open in their tree
        for (const agent of this.agentRegistry.values()) {
            if (agent.isWindowOpen) {
                const rootId = this.getRootId(agent.uuid);
                rootIdsWithOpenWindow.add(rootId);
            }
        }
        
        // Second pass: include all agents whose root has an open window
        for (const agent of this.agentRegistry.values()) {
            const rootId = this.getRootId(agent.uuid);
            if (rootIdsWithOpenWindow.has(rootId)) {
                nodes.push(agent);
            }
        }
        
        return nodes;
    }

    /**
     * Computes the runtime status of an agent.
     * @description Determines status based on running state, completion, and parent relationship.
     * @param {AgentStateInfo} agent - The agent state info
     * @returns {AgentRuntimeStatus} The computed runtime status
     * @example
     * const status = orchestrator.computeStatus(agent);
     * // Returns 'running', 'finished', 'pending', or 'standby'
     */
    public computeStatus(agent: AgentStateInfo): AgentRuntimeStatus {
        if (agent.isRunning) {
            return 'running';
        }
        if (agent.isTaskFinished) {
            return 'finished';
        }
        if (agent.parentId) {
            return 'pending';
        }
        return 'standby';
    }

    /**
     * Requests a fork to create sub-agents.
     * @description Creates multiple sub-agents as specified, waits for their completion,
     * and aggregates their results into a final report.
     * @param {string} parentId - UUID of the parent agent
     * @param {string} contextSummary - Summary context for the fork operation
     * @param {Array<{prompt: string; allowed_uris: string[]; model?: string}>} subAgents - Sub-agent configurations
     * @param {AbortSignal} [signal] - Optional abort signal for cancellation
     * @returns {Promise<string>} Aggregated report from all sub-agents
     * @throws {Error} If the operation is aborted
     * @example
     * const report = await orchestrator.requestFork(parentId, 'Task summary', [
     *   { prompt: 'Process A', allowed_uris: ['/path'] },
     *   { prompt: 'Process B', allowed_uris: ['/path'] }
     * ]);
     */
    public async requestFork(
        parentId: string, 
        contextSummary: string, 
        subAgents: { prompt: string; allowed_uris: string[]; model?: string }[],
        signal?: AbortSignal
    ): Promise<string> {
        return new Promise(async (resolve, reject) => {
            if (signal?.aborted) {
                return reject(new Error('Operation aborted'));
            }

            const sessionChildUuids = new Set<string>();
            const session: ForkSession = {
                parentId,
                resolve,
                reject,
                childUuids: sessionChildUuids,
                results: new Map(),
                deletedChildren: new Set()
            };

            this.activeForks.set(parentId, session);

            for (const subAgent of subAgents) {
                try {
                    const childUuid = uuidv4();
                    sessionChildUuids.add(childUuid);
                    await this.createAndOpenAgent(
                        childUuid, 
                        parentId, 
                        subAgent.prompt, 
                        subAgent.allowed_uris, 
                        subAgent.model
                    );
                } catch (e) {
                    console.error('Failed to create sub agent', e);
                }
            }

            this.refreshUI();
            
            if (signal) {
                signal.addEventListener('abort', () => {
                    this.cancelSession(parentId, 'User aborted execution');
                });
            }
        });
    }

    /**
     * Creates a new sub-agent file and opens its notebook window.
     * @private
     * @param {string} uuid - UUID for the new agent
     * @param {string} parentId - Parent agent ID
     * @param {string} prompt - Initial prompt for the agent
     * @param {string[]} allowedUris - Allowed URIs for the agent
     * @param {string} [model] - Model identifier to use
     * @returns {Promise<void>}
     * @example
     * await this.createAndOpenAgent(uuid, parentId, 'Process files', ['/workspace'], 'gpt-4');
     */
    private async createAndOpenAgent(
        uuid: string, 
        parentId: string, 
        prompt: string, 
        allowedUris: string[], 
        model?: string
    ): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
        if (!workspaceRoot) {
            return;
        }

        const folderUri = workspaceRoot.with({
            path: path.posix.join(workspaceRoot.path, '.mutsumi'),
        });
        const fileUri = folderUri.with({
            path: path.posix.join(folderUri.path, `${uuid}.mtm`),
        });

        try { 
            await vscode.workspace.fs.createDirectory(folderUri); 
        } catch {
            // Directory may already exist
        }

        const config = vscode.workspace.getConfiguration('mutsumi');
        const defaultModel = config.get<string>('defaultModel') || 'gpt-3.5-turbo';
        const availableModels = config.get<Record<string, string>>('models', {});
        const availableModelNames = Object.keys(availableModels);

        const selectedModel = (model && availableModelNames.includes(model)) ? model : defaultModel;

        // Get parent's sub_agents_list and add this child
        const parent = this.agentRegistry.get(parentId);
        const parentSubAgents = parent?.childIds ? Array.from(parent.childIds) : [];
        parentSubAgents.push(uuid);

        const content: any = {
            metadata: {
                uuid: uuid,
                name: prompt.slice(0, 20) + '...',
                created_at: new Date().toISOString(),
                parent_agent_id: parentId,
                allowed_uris: allowedUris,
                is_task_finished: false,
                model: selectedModel,
                sub_agents_list: []  // New agent starts with empty sub-agent list
            },
            context: [
                { role: 'user', content: prompt }
            ]
        };
        
        const encoded = new TextEncoder().encode(JSON.stringify(content, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        // Update parent's sub_agents_list in file
        if (parent) {
            if (!parent.childIds) {
                parent.childIds = new Set();
            }
            parent.childIds.add(uuid);
            await this.updateParentSubAgentsList(parentId);
        }

        this.agentRegistry.set(uuid, {
            uuid,
            parentId,
            name: prompt.slice(0, 20),
            fileUri: fileUri.toString(),
            isWindowOpen: true,
            isRunning: false,
            isTaskFinished: false,
            prompt,
            childIds: new Set()
        });

        try {
            const doc = await vscode.workspace.openNotebookDocument(fileUri);
            await vscode.window.showNotebookDocument(doc, {
                viewColumn: vscode.ViewColumn.Active,
                preserveFocus: true,
                preview: false
            });
        } catch (e) {
            console.error('Failed to open notebook window', e);
        }
    }

    /**
     * Cancels an active fork session.
     * @private
     * @param {string} parentId - Parent agent ID of the session to cancel
     * @param {string} reason - Reason for cancellation
     */
    private cancelSession(parentId: string, reason: string): void {
        const session = this.activeForks.get(parentId);
        if (session) {
            session.reject(new Error(reason));
            this.activeForks.delete(parentId);
            this.refreshUI();
        }
    }

    // ================== Event Notifications ==================

    /**
     * Notifies that a notebook has been opened.
     * @description Called when a notebook document is opened. Registers or updates
     * the agent state in the registry and loads the entire agent tree.
     * @param {string} uuid - Agent UUID
     * @param {vscode.Uri} uri - Document URI
     * @param {any} metadata - Notebook metadata
     * @example
     * orchestrator.notifyNotebookOpened(uuid, uri, metadata);
     */
    public async notifyNotebookOpened(uuid: string, uri: vscode.Uri, metadata: any): Promise<void> {
        let agent = this.agentRegistry.get(uuid);
        const isFinished = !!metadata?.is_task_finished;
        const childIds = new Set<string>(metadata?.sub_agents_list || []);

        if (!agent) {
            agent = {
                uuid,
                parentId: metadata.parent_agent_id || null,
                name: metadata.name || 'Unknown Agent',
                fileUri: uri.toString(),
                isWindowOpen: true,
                isRunning: false,
                isTaskFinished: isFinished,
                childIds
            };
            this.agentRegistry.set(uuid, agent);
        } else {
            agent.isWindowOpen = true;
            agent.fileUri = uri.toString();
            agent.childIds = childIds;
            if (isFinished) {
                agent.isTaskFinished = true;
            }
        }
        
        // Load the entire tree including all descendants
        await this.loadAgentTree(uuid);
        
        // Also load ancestors to ensure complete tree context
        if (agent.parentId) {
            await this.loadAgentTree(agent.parentId);
        }
        
        this.refreshUI();
    }

    /**
     * Notifies that a notebook has been closed.
     * @description Updates the agent's window state. Only hides the tree when 
     * all agents in the tree have their windows closed.
     * @param {string} uuid - Agent UUID
     * @example
     * orchestrator.notifyNotebookClosed(uuid);
     */
    public notifyNotebookClosed(uuid: string): void {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isWindowOpen = false;
            this.refreshUI();
        }
    }

    /**
     * Notifies that an agent has started running.
     * @description Called by the controller when execution begins.
     * @param {string} uuid - Agent UUID
     * @example
     * orchestrator.notifyAgentStarted(uuid);
     */
    public notifyAgentStarted(uuid: string): void {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isRunning = true;
            this.refreshUI();
        }
    }

    /**
     * Notifies that an agent has stopped running.
     * @description Called by the controller when execution ends.
     * @param {string} uuid - Agent UUID
     * @example
     * orchestrator.notifyAgentStopped(uuid);
     */
    public notifyAgentStopped(uuid: string): void {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isRunning = false;
            this.refreshUI();
        }
    }

    /**
     * Reports that a sub-agent task has finished.
     * @description Called when the task_finish tool is invoked by a sub-agent.
     * Stores the result and checks if all sub-agents in the fork session are complete.
     * @param {string} childUuid - Child agent UUID
     * @param {string} summary - Task completion summary
     * @example
     * orchestrator.reportTaskFinished(childUuid, 'Task completed successfully');
     */
    public reportTaskFinished(childUuid: string, summary: string): void {
        const agent = this.agentRegistry.get(childUuid);
        if (!agent) {
            return;
        }

        agent.isTaskFinished = true;
        this.refreshUI();

        if (agent.parentId) {
            const session = this.activeForks.get(agent.parentId);
            if (session && session.childUuids.has(childUuid)) {
                session.results.set(childUuid, summary);
                this.checkSessionCompletion(agent.parentId);
            }
        }
    }

    /**
     * Notifies that an agent file has been deleted.
     * @description Removes the agent from the registry, cleans up bidirectional references,
     * and updates any active fork sessions. If parent doesn't exist, the agent becomes independent.
     * @param {vscode.Uri} uri - URI of the deleted file
     * @returns {Promise<void>}
     * @example
     * await orchestrator.notifyFileDeleted(uri);
     */
    public async notifyFileDeleted(uri: vscode.Uri): Promise<void> {
        const uriStr = uri.toString();
        let deletedUuid: string | undefined;
        for (const [uuid, agent] of this.agentRegistry.entries()) {
            if (agent.fileUri === uriStr) {
                deletedUuid = uuid;
                break;
            }
        }

        if (!deletedUuid) return;
        
        const agent = this.agentRegistry.get(deletedUuid)!;
        const parentId = agent.parentId;
        
        // Clean up parent's reference to this child
        if (parentId) {
            const parent = this.agentRegistry.get(parentId);
            if (parent && parent.childIds) {
                parent.childIds.delete(deletedUuid);
                // Update parent's file
                await this.updateParentSubAgentsList(parentId);
            }
        }
        
        // Clean up children's references to this parent
        if (agent.childIds) {
            for (const childId of agent.childIds) {
                const child = this.agentRegistry.get(childId);
                if (child && child.parentId === deletedUuid) {
                    // Parent is being deleted, child becomes independent
                    child.parentId = null;
                    await this.updateAgentParentInFile(childId, null);
                }
            }
        }
        
        // Remove from registry
        this.agentRegistry.delete(deletedUuid);

        // Update fork session if applicable
        if (parentId) {
            const session = this.activeForks.get(parentId);
            if (session && session.childUuids.has(deletedUuid)) {
                session.deletedChildren.add(deletedUuid);
                this.checkSessionCompletion(parentId);
            }
        }
        
        this.refreshUI();
    }

    /**
     * Checks if a fork session is complete and resolves the promise.
     * @private
     * @description Called when a child agent finishes or is deleted. If all children
     * have been accounted for, generates the final report and resolves the session.
     * @param {string} parentId - Parent agent ID of the session
     */
    private checkSessionCompletion(parentId: string): void {
        const session = this.activeForks.get(parentId);
        if (!session) {
            return;
        }

        let allAccountedFor = true;
        for (const childId of session.childUuids) {
            if (!session.results.has(childId) && !session.deletedChildren.has(childId)) {
                allAccountedFor = false;
                break;
            }
        }

        if (allAccountedFor) {
            const successSummaries = Array.from(session.results.entries())
                .map(([uuid, text]) => {
                    const name = this.agentRegistry.get(uuid)?.name || uuid.slice(0, 6);
                    return `### Sub-agent '${name}' Finished:\n${text}`;
                });
            
            const deletedSummaries = Array.from(session.deletedChildren).map(uuid => {
                return `### Sub-agent ${uuid.slice(0, 6)} was deleted (Cancelled).`;
            });

            const finalReport = [...successSummaries, ...deletedSummaries].join('\n\n----------------\n\n');
            
            if (!finalReport.trim()) {
                session.resolve('All sub-agents were deleted or produced no output.');
            } else {
                session.resolve(finalReport);
            }
            
            this.activeForks.delete(parentId);
        }
    }

    /**
     * Retrieves an agent by its UUID.
     * @param {string} uuid - Agent UUID
     * @returns {AgentStateInfo | undefined} The agent state info or undefined if not found
     * @example
     * const agent = orchestrator.getAgentById(uuid);
     */
    public getAgentById(uuid: string): AgentStateInfo | undefined {
        return this.agentRegistry.get(uuid);
    }

    /**
     * Refreshes the sidebar UI.
     * @private
     */
    private refreshUI(): void {
        if (this.sidebar) {
            this.sidebar.update();
        }
    }
}
