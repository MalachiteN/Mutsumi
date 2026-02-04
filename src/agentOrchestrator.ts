import * as vscode from 'vscode';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AgentSidebarProvider } from './sidebar/agentSidebar';
import { AgentController } from './controller';
import { AgentStateInfo, AgentRuntimeStatus } from './types';

interface ForkSession {
    parentId: string;
    resolve: (value: string | PromiseLike<string>) => void;
    reject: (reason?: any) => void;
    childUuids: Set<string>;
    results: Map<string, string>; // uuid -> report content
    deletedChildren: Set<string>; // 记录被删除的子Agent
}

export class AgentOrchestrator {
    private static instance: AgentOrchestrator;
    private sidebar?: AgentSidebarProvider;
    private agentController?: AgentController;
    private notebookController?: vscode.NotebookController;
    
    // 全局 Agent 状态注册表 (UUID -> Info)
    private agentRegistry = new Map<string, AgentStateInfo>();
    
    // 活跃的 Fork 会话 (ParentUUID -> Session)
    private activeForks = new Map<string, ForkSession>();

    private constructor() {}

    public static getInstance(): AgentOrchestrator {
        if (!AgentOrchestrator.instance) {
            AgentOrchestrator.instance = new AgentOrchestrator();
        }
        return AgentOrchestrator.instance;
    }

    public setSidebar(sidebar: AgentSidebarProvider) {
        this.sidebar = sidebar;
    }

    public registerController(agentController: AgentController, notebookController: vscode.NotebookController) {
        this.agentController = agentController;
        this.notebookController = notebookController;
    }

    /**
     * 计算并获取用于 TreeView 展示的节点列表
     */
    public getAgentTreeNodes(): AgentStateInfo[] {
        const nodes: AgentStateInfo[] = [];

        for (const agent of this.agentRegistry.values()) {
            // UI Rule: If a sub-agent is finished and the window is closed, hide it from the tree
            if (agent.isTaskFinished && !agent.isWindowOpen) {
                continue;
            }

            // UI Rule: Standby parents (window open, not running) -> Show
            // UI Rule: Hidden parents (window closed, not running) -> Hide (Skip)
            if (!agent.parentId && !agent.isRunning && !agent.isWindowOpen) {
                continue;
            }

            // Otherwise show it
            nodes.push(agent);
        }
        return nodes;
    }

    public computeStatus(agent: AgentStateInfo): AgentRuntimeStatus {
        if (agent.isRunning) return 'running';
        if (agent.isTaskFinished) return 'finished';
        if (agent.parentId) return 'pending'; // 子Agent，未运行未完成
        return 'standby'; // 母Agent，未运行
    }

    /**
     * 工具调用请求 Fork
     */
    public async requestFork(
        parentId: string, 
        contextSummary: string, 
        subAgents: { prompt: string; allowed_uris: string[] }[],
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

            // Create files and open windows
            for (const subAgent of subAgents) {
                try {
                    const childUuid = uuidv4();
                    sessionChildUuids.add(childUuid);
                    await this.createAndOpenAgent(childUuid, parentId, subAgent.prompt, subAgent.allowed_uris);
                } catch (e) {
                    console.error('Failed to create sub agent', e);
                }
            }

            // 更新 UI
            this.refreshUI();
            
            // 挂起，等待 checkSessionCompletion 在未来被调用
            if (signal) {
                signal.addEventListener('abort', () => {
                    this.cancelSession(parentId, 'User aborted execution');
                });
            }
        });
    }

    private async createAndOpenAgent(uuid: string, parentId: string, prompt: string, allowedUris: string[]) {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri;
        if (!workspaceRoot) return;

        const folderUri = workspaceRoot.with({
            path: path.posix.join(workspaceRoot.path, '.mutsumi'),
        });
        const fileUri = folderUri.with({
            path: path.posix.join(folderUri.path, `${uuid}.mtm`),
        });

        // 确保目录存在
        try { await vscode.workspace.fs.createDirectory(folderUri); } catch {}

        // 准备内容
        const content: any = {
            metadata: {
                uuid: uuid,
                name: prompt.slice(0, 20) + '...',
                created_at: new Date().toISOString(),
                parent_agent_id: parentId,
                allowed_uris: allowedUris,
                is_task_finished: false
            },
            context: [
                { role: 'user', content: prompt }
            ]
        };
        
        const encoded = new TextEncoder().encode(JSON.stringify(content, null, 2));
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        // Register in memory
        this.agentRegistry.set(uuid, {
            uuid,
            parentId,
            name: prompt.slice(0, 20),
            fileUri: fileUri.toString(),
            isWindowOpen: true, // Will be opened immediately below
            isRunning: false,
            isTaskFinished: false,
            prompt
        });

        // Open window automatically to the side
        try {
            const doc = await vscode.workspace.openNotebookDocument(fileUri);
            await vscode.window.showNotebookDocument(doc, {
                viewColumn: vscode.ViewColumn.Beside,
                preserveFocus: true 
            });
        } catch (e) {
            console.error('Failed to open notebook window', e);
        }
    }

    private cancelSession(parentId: string, reason: string) {
        const session = this.activeForks.get(parentId);
        if (session) {
            session.reject(new Error(reason));
            this.activeForks.delete(parentId);
            this.refreshUI();
        }
    }

    // ================== 事件监听与状态更新 ==================

    /**
     * 当文件被打开时调用 (Extension -> Orchestrator)
     */
    public notifyNotebookOpened(uuid: string, uri: vscode.Uri, metadata: any) {
        let agent = this.agentRegistry.get(uuid);
        
        // Check if metadata says it's finished
        const isFinished = !!metadata?.is_task_finished;

        if (!agent) {
            agent = {
                uuid,
                parentId: metadata.parent_agent_id || null,
                name: metadata.name || 'Unknown Agent',
                fileUri: uri.toString(),
                isWindowOpen: true,
                isRunning: false,
                isTaskFinished: isFinished
            };
            this.agentRegistry.set(uuid, agent);
        } else {
            agent.isWindowOpen = true;
            agent.fileUri = uri.toString();
            // If we re-open and find it marked as finished, update state
            if (isFinished) {
                agent.isTaskFinished = true;
            }
        }
        this.refreshUI();
    }

    /**
     * 当文件被关闭时调用
     */
    public notifyNotebookClosed(uuid: string) {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isWindowOpen = false;
            // If it's a finished sub-agent, this will cause it to hide on next refresh
            this.refreshUI();
        }
    }

    /**
     * 当 Agent 开始运行时调用 (Controller -> Orchestrator)
     */
    public notifyAgentStarted(uuid: string) {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isRunning = true;
            this.refreshUI();
        }
    }

    /**
     * 当 Agent 停止运行时调用
     */
    public notifyAgentStopped(uuid: string) {
        const agent = this.agentRegistry.get(uuid);
        if (agent) {
            agent.isRunning = false;
            this.refreshUI();
        }
    }

    /**
     * 当 task_finish 工具被调用时
     */
    public reportTaskFinished(childUuid: string, summary: string) {
        const agent = this.agentRegistry.get(childUuid);
        if (!agent) return;

        agent.isTaskFinished = true;
        this.refreshUI();

        // 如果它是某个 Fork 会话的子 Agent
        if (agent.parentId) {
            const session = this.activeForks.get(agent.parentId);
            if (session && session.childUuids.has(childUuid)) {
                session.results.set(childUuid, summary);
                this.checkSessionCompletion(agent.parentId);
            }
        }
    }

    /**
     * 当文件被删除时调用 (Extension -> Orchestrator)
     */
    public async notifyFileDeleted(uri: vscode.Uri) {
        const uriStr = uri.toString();
        // 查找对应的 Agent
        let deletedUuid: string | undefined;
        for (const [uuid, agent] of this.agentRegistry.entries()) {
            if (agent.fileUri === uriStr) {
                deletedUuid = uuid;
                break;
            }
        }

        if (deletedUuid) {
            const agent = this.agentRegistry.get(deletedUuid)!;
            
            // 从注册表移除
            this.agentRegistry.delete(deletedUuid);

            // 如果它是某个 Fork 的子 Agent，视为 Reject/Cancel
            if (agent.parentId) {
                const session = this.activeForks.get(agent.parentId);
                if (session && session.childUuids.has(deletedUuid)) {
                    session.deletedChildren.add(deletedUuid);
                    // 尝试检查是否所有子任务都已处理完（无论完成还是删除）
                    this.checkSessionCompletion(agent.parentId);
                }
            }
            
            this.refreshUI();
        }
    }

    private checkSessionCompletion(parentId: string) {
        const session = this.activeForks.get(parentId);
        if (!session) return;

        const totalChildren = session.childUuids.size;
        const finishedCount = session.results.size;
        const deletedCount = session.deletedChildren.size;

        // 检查所有子 Agent 是否都有了结果（不论是成功报告还是被删除）
        // 注意：这里简单的逻辑是只要子 Agent 的集合中，每一个 UUID 要么在 results 里，要么在 deletedChildren 里
        let allAccountedFor = true;
        for (const childId of session.childUuids) {
            if (!session.results.has(childId) && !session.deletedChildren.has(childId)) {
                allAccountedFor = false;
                break;
            }
        }

        if (allAccountedFor) {
            // 生成报告
            const successSummaries = Array.from(session.results.entries())
                .map(([uuid, text]) => {
                    const name = this.agentRegistry.get(uuid)?.name || uuid.slice(0,6);
                    return `### Sub-agent '${name}' Finished:\n${text}`;
                });
            
            const deletedSummaries = Array.from(session.deletedChildren).map(uuid => {
                return `### Sub-agent ${uuid.slice(0,6)} was deleted (Cancelled).`;
            });

            const finalReport = [...successSummaries, ...deletedSummaries].join('\n\n----------------\n\n');
            
            if (!finalReport.trim()) {
                session.resolve('All sub-agents were deleted or produced no output.');
            } else {
                session.resolve(finalReport);
            }
            
            this.activeForks.delete(parentId);
            // Parent will resume running automatically as the await returns
        }
    }

    public getAgentById(uuid: string) {
        return this.agentRegistry.get(uuid);
    }

    private refreshUI() {
        if (this.sidebar) {
            this.sidebar.update();
        }
    }
}