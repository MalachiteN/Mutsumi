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
     * Initializes the Orchestrator.
     * Loads all existing agent files from disk into the registry at startup.
     */
    public async initialize(): Promise<void> {
        try {
            const agents = await AgentFileOperations.scanAllAgents();
            for (const agent of agents) {
                // Ensure we don't overwrite if for some reason already present (though init runs first)
                if (!this.registry.hasAgent(agent.uuid)) {
                    this.registry.setAgent(agent.uuid, agent);
                }
            }
            console.log(`[AgentOrchestrator] Initialized with ${agents.length} agents from disk.`);
        } catch (e) {
            console.error('[AgentOrchestrator] Failed to initialize agents from disk:', e);
        }
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
     * @description Delegates to AgentTreeUtils.getAgentTreeNodes which builds
     * the tree based on current Registry state (specifically isWindowOpen flags).
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
     * @description Called when a notebook document is opened (e.g. creating a new agent or opening file).
     * Ensures the agent is in the registry.
     * @param {string} uuid - Agent UUID
     * @param {vscode.Uri} uri - Document URI
     * @param {any} metadata - Notebook metadata
     */
    public async notifyNotebookDocumentOpened(uuid: string, uri: vscode.Uri, metadata: any): Promise<void> {
        // We only add to registry if it doesn't exist (e.g. New Agent command)
        // or update URI if it exists (e.g. file move/rename handled elsewhere but good to be safe)
        let agent = this.registry.getAgent(uuid);
        const isFinished = !!metadata?.is_task_finished;
        const childIds = new Set<string>(metadata?.sub_agents_list || []);

        if (!agent) {
            agent = {
                uuid,
                parentId: metadata.parent_agent_id || null,
                name: metadata.name || 'Unknown Agent',
                fileUri: uri.toString(),
                isWindowOpen: false, // Default to false, strictly controlled by tab check
                isRunning: false,
                isTaskFinished: isFinished,
                childIds
            };
            this.registry.setAgent(uuid, agent);
        } else {
            // Update properties that might have changed on disk or via metadata
            agent.fileUri = uri.toString();
            // Merge childIds just in case, though mostly controlled by file
            // Actually, we trust the file/metadata source of truth here
            agent.childIds = childIds; 
            if (isFinished) {
                agent.isTaskFinished = true;
            }
            if (metadata.parent_agent_id !== undefined) {
                agent.parentId = metadata.parent_agent_id;
            }
        }

        // Trigger a tab sync to ensure state is consistent with actual tabs.
        this.notifyTabsChanged();
    }

    /**
     * Notifies that the set of open tabs has changed.
     * @description Scans all tab groups to find open Mutsumi notebook tabs.
     * Sets isWindowOpen based on presence in tabs, regardless of visibility (active/inactive).
     */
    public notifyTabsChanged(): void {
        const openFileUris = new Set<string>();

        for (const group of vscode.window.tabGroups.all) {
            for (const tab of group.tabs) {
                if (tab.input instanceof vscode.TabInputNotebook) {
                     openFileUris.add(tab.input.uri.toString());
                }
            }
        }
        
        // Update registry state
        let changed = false;
        for (const agent of this.registry.getAllAgents()) {
            const isOpen = openFileUris.has(agent.fileUri);
            if (agent.isWindowOpen !== isOpen) {
                agent.isWindowOpen = isOpen;
                changed = true;
            }
        }

        if (changed) {
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
     * Updates the name of an agent in the registry.
     * @description Called when the agent title is regenerated to keep registry in sync.
     * @param {string} uuid - Agent UUID
     * @param {string} newName - New name for the agent
     */
    public updateAgentName(uuid: string, newName: string): void {
        const agent = this.registry.getAgent(uuid);
        if (agent) {
            agent.name = newName;
            this.refreshUI();
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
            isWindowOpen: false, // Will be set to true by notifyTabsChanged
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
