/**
 * @fileoverview Orchestrates agent lifecycle, fork sessions, and UI state management.
 * @module agent/agentOrchestrator
 */

import * as vscode from 'vscode';
import { v4 as uuidv4 } from 'uuid';
import { AgentSidebarProvider } from '../sidebar/agentSidebar';
import { AgentController } from '../controller';
import { AgentStateInfo, AgentRuntimeStatus } from '../types';
import { ForkSession } from './types';
import { AgentRegistry } from './registry';
import { ForkSessionManager } from './fork';
import { AgentFileOperations } from './fileOps';
import { AgentTreeUtils } from './treeUtils';

/**
 * Orchestrates agent lifecycle, state management, and fork operations.
 * @description Manages the global agent registry, handles fork sessions for sub-agents,
 * and coordinates UI updates through the sidebar provider.
 * @class AgentOrchestrator
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

    /** Agent registry singleton */
    private registry = AgentRegistry.getInstance();
    /** Fork session manager singleton */
    private forkSessions = ForkSessionManager.getInstance();

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
     */
    public setSidebar(sidebar: AgentSidebarProvider): void {
        this.sidebar = sidebar;
    }

    /**
     * Registers the agent and notebook controllers.
     * @param {AgentController} agentController - The agent controller
     * @param {vscode.NotebookController} notebookController - The notebook controller
     */
    public registerController(
        agentController: AgentController,
        notebookController: vscode.NotebookController
    ): void {
        this.agentController = agentController;
        this.notebookController = notebookController;
    }

    /**
     * Computes and returns nodes for TreeView display.
     * @description Shows the entire tree if any node in the tree has an open window.
     * Only hides the tree when all nodes' windows are closed.
     * @returns {AgentStateInfo[]} Array of agent nodes to display
     */
    public getAgentTreeNodes(): AgentStateInfo[] {
        return AgentTreeUtils.getAgentTreeNodes(this.getRegistryMap());
    }

    /**
     * Computes the runtime status of an agent.
     * @description Determines status based on running state, completion, and parent relationship.
     * @param {AgentStateInfo} agent - The agent state info
     * @returns {AgentRuntimeStatus} The computed runtime status
     */
    public computeStatus(agent: AgentStateInfo): AgentRuntimeStatus {
        return AgentTreeUtils.computeStatus(agent);
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
            this.forkSessions.createSession(parentId, sessionChildUuids, resolve, reject);

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
     * Notifies that a notebook document has been opened.
     * @description Called when a notebook document is opened. Registers or updates
     * the agent state in the registry and loads the entire agent tree.
     * Note: This is for document lifecycle, NOT window state.
     * Use notifyNotebookWindowOpened for window state.
     * @param {string} uuid - Agent UUID
     * @param {vscode.Uri} uri - Document URI
     * @param {any} metadata - Notebook metadata
     */
    public async notifyNotebookDocumentOpened(uuid: string, uri: vscode.Uri, metadata: any): Promise<void> {
        let agent = this.registry.getAgent(uuid);
        const isFinished = !!metadata?.is_task_finished;
        const childIds = new Set<string>(metadata?.sub_agents_list || []);

        if (!agent) {
            agent = {
                uuid,
                parentId: metadata.parent_agent_id || null,
                name: metadata.name || 'Unknown Agent',
                fileUri: uri.toString(),
                isWindowOpen: false,
                isRunning: false,
                isTaskFinished: isFinished,
                childIds
            };
            this.registry.setAgent(uuid, agent);
        } else {
            agent.fileUri = uri.toString();
            agent.childIds = childIds;
            if (isFinished) {
                agent.isTaskFinished = true;
            }
        }

        await this.loadAgentTree(uuid);

        if (agent.parentId) {
            await this.loadAgentTree(agent.parentId);
        }

        this.refreshUI();
    }

    /**
     * Notifies that a notebook window has been opened/visible.
     * @description Called when a notebook editor becomes visible. This is the correct
     * way to track window state because VS Code caches NotebookDocument.
     * @param {string} uuid - Agent UUID
     * @param {vscode.Uri} uri - Document URI
     * @param {any} metadata - Notebook metadata
     */
    public notifyNotebookWindowOpened(uuid: string, uri: vscode.Uri, metadata: any): void {
        let agent = this.registry.getAgent(uuid);
        if (!agent) {
            const isFinished = !!metadata?.is_task_finished;
            const childIds = new Set<string>(metadata?.sub_agents_list || []);
            agent = {
                uuid,
                parentId: metadata?.parent_agent_id || null,
                name: metadata?.name || 'Unknown Agent',
                fileUri: uri.toString(),
                isWindowOpen: true,
                isRunning: false,
                isTaskFinished: isFinished,
                childIds
            };
            this.registry.setAgent(uuid, agent);
        } else {
            agent.isWindowOpen = true;
            agent.fileUri = uri.toString();
        }
        this.refreshUI();
    }

    /**
     * Notifies that the set of visible notebooks has changed.
     * @description Called when onDidChangeVisibleNotebookEditors fires.
     * Updates agent window state based on visibility. Handles both open and close cases
     * to properly support file rename scenarios where the URI changes.
     * @param {Set<string>} visibleUris - Set of currently visible notebook URIs
     */
    public notifyVisibleNotebooksChanged(visibleUris: Set<string>): void {
        let hasChanges = false;

        for (const agent of this.registry.getAllAgents()) {
            const isVisible = visibleUris.has(agent.fileUri);
            if (isVisible && !agent.isWindowOpen) {
                agent.isWindowOpen = true;
                hasChanges = true;
            } else if (!isVisible && agent.isWindowOpen) {
                agent.isWindowOpen = false;
                hasChanges = true;
            }
        }

        if (hasChanges) {
            this.refreshUI();
        }
    }

    /**
     * Notifies that an agent has started running.
     * @description Called by the controller when execution begins.
     * @param {string} uuid - Agent UUID
     */
    public notifyAgentStarted(uuid: string): void {
        const agent = this.registry.getAgent(uuid);
        if (agent) {
            agent.isRunning = true;
            this.refreshUI();
        }
    }

    /**
     * Notifies that an agent has stopped running.
     * @description Called by the controller when execution ends.
     * @param {string} uuid - Agent UUID
     */
    public notifyAgentStopped(uuid: string): void {
        const agent = this.registry.getAgent(uuid);
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
     */
    public reportTaskFinished(childUuid: string, summary: string): void {
        const agent = this.registry.getAgent(childUuid);
        if (!agent) {
            return;
        }

        agent.isTaskFinished = true;
        this.refreshUI();

        if (agent.parentId) {
            const added = this.forkSessions.addResult(agent.parentId, childUuid, summary);
            if (added) {
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
     */
    public async notifyFileDeleted(uri: vscode.Uri): Promise<void> {
        const uriStr = uri.toString();
        const agent = this.registry.findAgentByFileUri(uriStr);
        if (!agent) {
            return;
        }

        const deletedUuid = agent.uuid;
        const parentId = agent.parentId;

        if (parentId) {
            const parent = this.registry.getAgent(parentId);
            if (parent && parent.childIds) {
                parent.childIds.delete(deletedUuid);
                await this.updateParentSubAgentsList(parentId);
            }
        }

        if (agent.childIds) {
            for (const childId of agent.childIds) {
                const child = this.registry.getAgent(childId);
                if (child && child.parentId === deletedUuid) {
                    child.parentId = null;
                    await this.updateAgentParentInFile(childId, null);
                }
            }
        }

        this.registry.deleteAgent(deletedUuid);

        if (parentId) {
            const deleted = this.forkSessions.addDeletedChild(parentId, deletedUuid);
            if (deleted) {
                this.checkSessionCompletion(parentId);
            }
        }

        this.refreshUI();
    }

    /**
     * Retrieves an agent by its UUID.
     * @param {string} uuid - Agent UUID
     * @returns {AgentStateInfo | undefined} The agent state info or undefined if not found
     */
    public getAgentById(uuid: string): AgentStateInfo | undefined {
        return this.registry.getAgent(uuid);
    }

    /**
     * Updates the file URI of an agent after file rename.
     * @description Called when a notebook file is auto-renamed to keep the registry in sync.
     * @param {string} uuid - Agent UUID
     * @param {vscode.Uri} newUri - New file URI after rename
     */
    public updateAgentFileUri(uuid: string, newUri: vscode.Uri): void {
        const agent = this.registry.getAgent(uuid);
        if (agent) {
            agent.fileUri = newUri.toString();
            this.refreshUI();
        }
    }

    /**
     * Loads an agent from file if it exists.
     * @private
     * @param {string} uuid - Agent UUID to load
     * @returns {Promise<AgentStateInfo | undefined>} The loaded agent info or undefined
     */
    private async loadAgentFromFile(uuid: string): Promise<AgentStateInfo | undefined> {
        const agent = await AgentFileOperations.loadAgentFromFile(uuid);
        if (agent) {
            this.registry.setAgent(uuid, agent);
        }
        return agent;
    }

    /**
     * Recursively loads all agents in a tree starting from a root.
     * @private
     * @param {string} uuid - Root agent UUID to start loading from
     * @param {Set<string>} visited - Set of already visited UUIDs to prevent cycles
     * @returns {Promise<void>}
     */
    private async loadAgentTree(uuid: string, visited: Set<string> = new Set()): Promise<void> {
        if (visited.has(uuid)) {
            return;
        }
        visited.add(uuid);

        let agent = this.registry.getAgent(uuid);
        if (!agent) {
            agent = await this.loadAgentFromFile(uuid);
        }

        if (!agent) {
            return;
        }

        if (agent.parentId) {
            const parent = this.registry.getAgent(agent.parentId);
            if (!parent) {
                const parentFromFile = await this.loadAgentFromFile(agent.parentId);
                if (!parentFromFile) {
                    agent.parentId = null;
                    await this.updateAgentParentInFile(uuid, null);
                }
            }
        }

        if (agent.childIds) {
            const validChildren = new Set<string>();
            for (const childId of agent.childIds) {
                let child = this.registry.getAgent(childId);
                if (!child) {
                    child = await this.loadAgentFromFile(childId);
                }

                if (child) {
                    validChildren.add(childId);
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
        const agent = this.registry.getAgent(uuid);
        if (!agent) {
            return;
        }
        await AgentFileOperations.updateAgentParentInFile(agent, newParentId);
    }

    /**
     * Updates the sub_agents_list of a parent agent in its file.
     * @private
     * @param {string} parentUuid - Parent agent UUID
     * @returns {Promise<void>}
     */
    private async updateParentSubAgentsList(parentUuid: string): Promise<void> {
        const parent = this.registry.getAgent(parentUuid);
        if (!parent) {
            return;
        }
        await AgentFileOperations.updateParentSubAgentsList(parent);
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
     */
    private async createAndOpenAgent(
        uuid: string,
        parentId: string,
        prompt: string,
        allowedUris: string[],
        model?: string
    ): Promise<void> {
        const parent = this.registry.getAgent(parentId);
        const parentSubAgents = parent?.childIds ? Array.from(parent.childIds) : [];
        parentSubAgents.push(uuid);

        const fileUri = await AgentFileOperations.createAgentFile(
            uuid,
            parentId,
            prompt,
            allowedUris,
            model,
            parentSubAgents
        );

        if (!fileUri) {
            return;
        }

        if (parent) {
            if (!parent.childIds) {
                parent.childIds = new Set();
            }
            parent.childIds.add(uuid);
        }

        this.registry.setAgent(uuid, {
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
        const cancelled = this.forkSessions.cancelSession(parentId, reason);
        if (cancelled) {
            this.refreshUI();
        }
    }

    /**
     * Checks if a fork session is complete and resolves the promise.
     * @private
     * @description Called when a child agent finishes or is deleted. If all children
     * have been accounted for, generates the final report and resolves the session.
     * @param {string} parentId - Parent agent ID of the session
     */
    private checkSessionCompletion(parentId: string): void {
        const session = this.forkSessions.getSession(parentId);
        if (!session) {
            return;
        }

        if (!this.forkSessions.isSessionComplete(parentId)) {
            return;
        }

        const report = this.forkSessions.generateReport(parentId, this.getRegistryMap());
        session.resolve(report);
        this.forkSessions.deleteSession(parentId);
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

    /**
     * Builds a registry map for tree utilities and fork reports.
     * @private
     * @returns {Map<string, AgentStateInfo>} Map of agent UUIDs to agent info
     */
    private getRegistryMap(): Map<string, AgentStateInfo> {
        return new Map(this.registry.getAllAgents().map(agent => [agent.uuid, agent]));
    }
}
