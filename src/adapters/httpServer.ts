import * as vscode from 'vscode';
import express = require('express');
import bodyParser = require('body-parser');
import { v4 as uuidv4 } from 'uuid';
import { AgentFileOperations } from '../agent/fileOps';
import { AgentRegistry } from '../agent/registry';
import { AgentOrchestrator } from '../agent/agentOrchestrator';
import { MutsumiSerializer } from '../notebook/serializer';
import { approvalManager } from '../tools.d/permission';
import { AgentRunner } from '../agent/agentRunner';
import { ToolManager } from '../tools.d/toolManager';
import { HeadlessAdapter } from './headlessAdapter';
import type { AgentSessionConfig, IAgentSession } from './interfaces';
import type { AgentMessage, AgentMetadata, AgentContext } from '../types';

export interface HttpServerOptions {
    port?: number;
}

export class HttpServer {
    private readonly app = express();
    private readonly port: number;
    private server?: ReturnType<typeof this.app.listen>;
    private readonly adapter: HeadlessAdapter;
    private readonly toolManager: ToolManager;
    private readonly abortControllers = new Map<string, AbortController>();

    constructor(adapter: HeadlessAdapter, options?: HttpServerOptions) {
        this.adapter = adapter;
        this.port = options?.port ?? 3000;
        this.toolManager = ToolManager.getInstance();
    }

    start(): void {
        if (this.server) return;

        this.configureServer();
        this.server = this.app.listen(this.port, () => {
            console.log(`[Mutsumi] HttpServer listening on port ${this.port}`);
        });
    }

    stop(): void {
        if (!this.server) return;
        this.server.close();
        this.server = undefined;
    }

    private configureServer(): void {
        this.app.use(bodyParser.json({ limit: '2mb' }));

        // Create a new agent
        this.app.post('/agents', (req: express.Request, res: express.Response) => {
            void this.handleCreateAgent(req, res);
        });

        // Get all agents from registry
        this.app.get('/agents', (req: express.Request, res: express.Response) => {
            void this.handleListAgents(req, res);
        });

        // Chat with an agent
        this.app.post('/agent/:uuid/chat', (req: express.Request, res: express.Response) => {
            void this.handleChat(req, res);
        });

        // Get agent details with full history
        this.app.get('/agent/:uuid', (req: express.Request, res: express.Response) => {
            void this.handleGetAgent(req, res);
        });

        // Delete an agent
        this.app.delete('/agent/:uuid', (req: express.Request, res: express.Response) => {
            void this.handleDeleteAgent(req, res);
        });

        // Set agent model
        this.app.put('/agent/:uuid/model', (req: express.Request, res: express.Response) => {
            void this.handleSetModel(req, res);
        });

        // Stop agent generation
        this.app.post('/agent/:uuid/stop', (req: express.Request, res: express.Response) => {
            void this.handleStopAgent(req, res);
        });

        // Approval endpoints
        this.app.post('/approval/:id/approve', (req: express.Request, res: express.Response) => {
            void this.handleApproval(req, res, 'approve');
        });

        this.app.post('/approval/:id/reject', (req: express.Request, res: express.Response) => {
            void this.handleApproval(req, res, 'reject');
        });

        this.app.post('/approval/:id/custom', (req: express.Request, res: express.Response) => {
            void this.handleApproval(req, res, 'custom');
        });
    }

    private async handleApproval(req: express.Request, res: express.Response, action: 'approve' | 'reject' | 'custom'): Promise<void> {
        const idParam = req.params.id;
        const id = Array.isArray(idParam) ? idParam[0] : idParam;
        const request = approvalManager.getRequest(id);

        if (!request) {
            res.status(404).json({ status: 'error', content: 'Approval request not found.' });
            return;
        }

        if (request.status !== 'pending') {
            res.status(400).json({ status: 'error', content: `Request is already ${request.status}.` });
            return;
        }

        try {
            switch (action) {
                case 'approve':
                    await approvalManager.approveRequest(id);
                    break;
                case 'reject':
                    await approvalManager.rejectRequest(id);
                    break;
                case 'custom':
                    if (!request.customAction) {
                        res.status(400).json({ status: 'error', content: 'No custom action available for this request.' });
                        return;
                    }
                    await approvalManager.handleCustomAction(id);
                    break;
            }
            res.json({ status: 'ok', content: `Action ${action} executed.` });
        } catch (e: any) {
            res.status(500).json({ status: 'error', content: e.message });
        }
    }

    private async handleChat(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        const { prompt, model } = req.body ?? {};

        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        if (typeof prompt !== 'string' || !prompt.trim()) {
            res.status(400).json({ status: 'error', content: 'Missing prompt.' });
            return;
        }

        const fileUri = AgentFileOperations.getAgentFileUri(uuid);
        if (!fileUri) {
            res.status(500).json({ status: 'error', content: 'No workspace available.' });
            return;
        }

        let content: Uint8Array;
        try {
            content = await vscode.workspace.fs.readFile(fileUri);
        } catch {
            res.status(404).json({ status: 'error', content: 'Agent file not found.' });
            return;
        }

        const serializer = new MutsumiSerializer();
        const tokenSource = new vscode.CancellationTokenSource();
        const notebookData = await serializer.deserializeNotebook(content, tokenSource.token);

        // Get VS Code configuration
        const config = vscode.workspace.getConfiguration('mutsumi');
        const apiKey = config.get<string>('apiKey');
        const baseUrl = config.get<string>('baseUrl') || undefined;
        const defaultModel = config.get<string>('defaultModel');
        const maxLoops = config.get<number>('maxLoops') || 30;

        // Determine model to use: request param > notebook metadata > VS Code config
        const effectiveModel = model || (notebookData.metadata as AgentMetadata)?.model || defaultModel;

        if (!effectiveModel) {
            res.status(500).json({ status: 'error', content: 'No model specified. Provide model in request body, notebook metadata, or VS Code settings.' });
            return;
        }

        if (!apiKey) {
            res.status(500).json({ status: 'error', content: 'No API key configured. Set mutsumi.apiKey in VS Code settings.' });
            return;
        }

        // Update metadata if model was provided in request
        if (model && notebookData.metadata) {
            (notebookData.metadata as AgentMetadata).model = model;
        }

        // Get allowedUris from notebook metadata
        const metadata = notebookData.metadata as AgentMetadata;
        const allowedUris = metadata?.allowed_uris || ['/'];
        const isSubAgent = !!metadata?.parent_agent_id;

        // Create session config
        const sessionConfig: AgentSessionConfig = {
            model: effectiveModel,
            apiKey,
            baseUrl,
            maxLoops,
            allowedUris,
            isSubAgent,
            metadata
        };

        // Create or get session using adapter
        let session = this.adapter.getSession(uuid);
        if (!session) {
            session = await this.adapter.createSession({
                sessionId: uuid,
                resourceUri: fileUri,
                config: sessionConfig
            });
        }

        // Set the input prompt
        (session as any).setInput(prompt);

        // Append user message to history
        const userMessage: AgentMessage = { role: 'user', content: prompt };

        // Get existing history and append new user message
        const history = await session.getHistory();
        history.push(userMessage);

        // Serialize updated history back to file (persist user message)
        const userCell = new vscode.NotebookCellData(
            vscode.NotebookCellKind.Code,
            prompt,
            'markdown'
        );
        userCell.metadata = { role: 'user' };
        const notebookDataWithUser = new vscode.NotebookData([
            ...notebookData.cells,
            userCell
        ]);
        notebookDataWithUser.metadata = notebookData.metadata;
        const encoded = await serializer.serializeNotebook(notebookDataWithUser, tokenSource.token);
        await vscode.workspace.fs.writeFile(fileUri, encoded);

        // Update session history
        (session as any).setHistory(history);

        // Create AgentRunner options
        const runnerOptions = {
            model: effectiveModel,
            apiKey,
            baseUrl,
            maxLoops
        };

        // Create AbortController for cancellation
        const abortController = new AbortController();
        this.abortControllers.set(uuid, abortController);

        // Start the agent run asynchronously (don't await - return immediately)
        void (async () => {
            try {
                const runner = new AgentRunner(runnerOptions, this.toolManager, session!);
                const newMessages = await runner.run(abortController, history);

                // Update session with new history
                const updatedHistory = [...history, ...newMessages];
                (session as any).setHistory(updatedHistory);

                console.log(`[Mutsumi] Agent ${uuid} completed with ${newMessages.length} new messages`);
            } catch (error: any) {
                console.error(`[Mutsumi] Agent ${uuid} error:`, error);

                // Append error as assistant message
                const errorMessage: AgentMessage = {
                    role: 'assistant',
                    content: `> ⚠️ **Error**: ${error.message || String(error)}\n\n*Execution failed.*`
                };
                const errorHistory = [...history, errorMessage];
                (session as any).setHistory(errorHistory);

                // Persist error to file
                await session!.save();
            } finally {
                this.abortControllers.delete(uuid);
            }
        })();

        // Return immediately with accepted status
        res.json({
            status: 'accepted',
            content: 'Agent run started. Use GET /agent/:uuid to check status.',
            sessionId: uuid,
            model: effectiveModel
        });
    }

    private async handleGetAgent(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        const agent = await AgentFileOperations.loadAgentFromFile(uuid);
        if (!agent) {
            res.status(404).json({ status: 'error', content: 'Agent not found.' });
            return;
        }

        // Load full history from file
        const fileUri = AgentFileOperations.getAgentFileUri(uuid);
        let history: AgentMessage[] = [];
        if (fileUri) {
            try {
                const content = await vscode.workspace.fs.readFile(fileUri);
                const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;
                if (Array.isArray(data.context)) {
                    history = data.context;
                }
            } catch {
                // Ignore, return empty history
            }
        }

        // Get current session output if exists
        const session = this.adapter.getSession(uuid);
        const currentOutput = session ? await (session as any).getCurrentOutput() : '';

        res.json({
            status: 'ok',
            agent: {
                ...agent,
                childIds: Array.from(agent.childIds ?? [])
            },
            history,
            currentOutput: currentOutput || undefined
        });
    }

    private async handleListAgents(req: express.Request, res: express.Response): Promise<void> {
        const registry = AgentRegistry.getInstance();
        const agents = registry.getAllAgents();

        res.json({
            status: 'ok',
            agents: agents.map(agent => ({
                uuid: agent.uuid,
                name: agent.name
            }))
        });
    }

    private async handleCreateAgent(req: express.Request, res: express.Response): Promise<void> {
        try {
            // Execute the 'mutsumi.newAgent' command to create a new agent
            await vscode.commands.executeCommand('mutsumi.newAgent');
            
            res.status(201).json({
                status: 'created',
                content: 'New agent created via Mutsumi: New Agent command.'
            });
        } catch (error: any) {
            console.error('Failed to create agent:', error);
            res.status(500).json({ status: 'error', content: `Failed to create agent: ${error.message}` });
        }
    }

    private async handleDeleteAgent(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        // Get the agent from registry
        const registry = AgentRegistry.getInstance();
        const agent = registry.getAgent(uuid);
        if (!agent) {
            res.status(404).json({ status: 'error', content: 'Agent not found.' });
            return;
        }

        try {
            // Delete the file
            const fileUri = vscode.Uri.parse(agent.fileUri);
            await vscode.workspace.fs.delete(fileUri);

            // Notify orchestrator to clean up registry
            await AgentOrchestrator.getInstance().notifyFileDeleted(fileUri);

            res.json({
                status: 'deleted',
                agent: {
                    uuid,
                    name: agent.name
                }
            });
        } catch (error: any) {
            console.error('Failed to delete agent:', error);
            res.status(500).json({ status: 'error', content: `Failed to delete agent: ${error.message}` });
        }
    }

    private async handleSetModel(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        const { model } = req.body ?? {};
        if (typeof model !== 'string' || !model.trim()) {
            res.status(400).json({ status: 'error', content: 'Missing or invalid model parameter.' });
            return;
        }

        // Validate model exists in configuration
        const config = vscode.workspace.getConfiguration('mutsumi');
        const models = config.get<Record<string, string>>('models', {});
        const availableModels = Object.keys(models);

        if (!availableModels.includes(model)) {
            res.status(400).json({
                status: 'error',
                content: `Invalid model: ${model}. Available models: ${availableModels.join(', ')}`
            });
            return;
        }

        // Get the file URI
        const fileUri = AgentFileOperations.getAgentFileUri(uuid);
        if (!fileUri) {
            res.status(404).json({ status: 'error', content: 'Agent file not found.' });
            return;
        }

        try {
            // Read current content
            const content = await vscode.workspace.fs.readFile(fileUri);
            const data = JSON.parse(new TextDecoder().decode(content)) as AgentContext;

            // Update model in metadata
            data.metadata.model = model;

            // Write back
            const encoded = new TextEncoder().encode(JSON.stringify(data, null, 2));
            await vscode.workspace.fs.writeFile(fileUri, encoded);

            res.json({
                status: 'updated',
                agent: {
                    uuid,
                    model
                }
            });
        } catch (error: any) {
            console.error('Failed to set model:', error);
            res.status(500).json({ status: 'error', content: `Failed to set model: ${error.message}` });
        }
    }

    private async handleStopAgent(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        // Check if there's an active abort controller for this agent
        const abortController = this.abortControllers.get(uuid);
        if (!abortController) {
            res.status(404).json({ status: 'error', content: 'No active generation found for this agent.' });
            return;
        }

        // Abort the generation
        abortController.abort();
        this.abortControllers.delete(uuid);

        // Also cancel the session's token to stop the agent loop
        const session = this.adapter.getSession(uuid);
        if (session) {
            const headlessSession = session as any;
            if (headlessSession.tokenSource) {
                headlessSession.tokenSource.cancel();
            }
        }

        res.json({
            status: 'ok',
            content: 'Agent generation stopped.'
        });
    }
}
