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
import { initializeRules } from '../contextManagement/prompts';
import type { AgentSessionConfig, IAgentSession } from './interfaces';
import type { AgentMessage, AgentMetadata, AgentContext, AgentStateInfo } from '../types';

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
    private readonly extensionUri: vscode.Uri;

    constructor(adapter: HeadlessAdapter, extensionUri: vscode.Uri, options?: HttpServerOptions) {
        this.adapter = adapter;
        this.extensionUri = extensionUri;
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

    /**
     * Retrieves an agent from the registry by UUID.
     * This is the single source of truth for agent lookups.
     */
    private getAgentFromRegistry(uuid: string): AgentStateInfo | undefined {
        const registry = AgentRegistry.getInstance();
        return registry.getAgent(uuid);
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
        const { prompt, model, stream } = req.body ?? {};
        const isStreamMode = stream === true;

        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        if (typeof prompt !== 'string' || !prompt.trim()) {
            res.status(400).json({ status: 'error', content: 'Missing prompt.' });
            return;
        }

        // Get agent from registry to get the actual file URI
        const agentInfo = this.getAgentFromRegistry(uuid);
        if (!agentInfo) {
            res.status(404).json({ status: 'error', content: 'Agent not found.' });
            return;
        }

        const fileUri = vscode.Uri.parse(agentInfo.fileUri);

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

        // If stream mode is requested, setup SSE
        if (isStreamMode) {
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
            res.status(200);

            let lastOutputLength = 0;
            let isFinished = false;

            // Override session's replaceOutput to capture streaming content
            const originalReplaceOutput = session.replaceOutput.bind(session);

            session.replaceOutput = async (output: string, options?: { isMarkdown?: boolean }) => {
                // Call original method
                await originalReplaceOutput(output, options);

                // Get current output and send delta
                const currentOutput = await session.getCurrentOutput!();

                if (currentOutput.length > lastOutputLength && !isFinished) {
                    const delta = currentOutput.slice(lastOutputLength);
                    lastOutputLength = currentOutput.length;

                    // Send SSE event with HTML content preserved
                    const event = {
                        type: 'content',
                        content: delta,
                        fullContent: currentOutput
                    };
                    res.write(`data: ${JSON.stringify(event)}\n\n`);
                }
            };

            // Run the agent and stream results
            try {
                const runner = new AgentRunner(runnerOptions, this.toolManager, session);
                const newMessages = await runner.run(abortController, history);

                // Update session with new history
                const updatedHistory = [...history, ...newMessages];
                (session as any).setHistory(updatedHistory);

                isFinished = true;

                // Send final event
                const finalEvent = {
                    type: 'done',
                    messageCount: newMessages.length
                };
                res.write(`data: ${JSON.stringify(finalEvent)}\n\n`);
                res.end();

                console.log(`[Mutsumi] Agent ${uuid} streaming completed with ${newMessages.length} new messages`);
            } catch (error: any) {
                console.error(`[Mutsumi] Agent ${uuid} streaming error:`, error);
                isFinished = true;

                // Send error as SSE event
                const errorEvent = {
                    type: 'error',
                    error: error.message || String(error)
                };
                res.write(`data: ${JSON.stringify(errorEvent)}\n\n`);
                res.end();

                // Append error as assistant message
                const errorMessage: AgentMessage = {
                    role: 'assistant',
                    content: `> ⚠️ **Error**: ${error.message || String(error)}\n\n*Execution failed.*`
                };
                const errorHistory = [...history, errorMessage];
                (session as any).setHistory(errorHistory);
                await session.save();
            } finally {
                this.abortControllers.delete(uuid);
                // Restore original method
                session.replaceOutput = originalReplaceOutput;
            }
        } else {
            // Non-streaming mode: original behavior
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
    }

    private async handleGetAgent(req: express.Request, res: express.Response): Promise<void> {
        const uuidParam = req.params.uuid;
        const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
        if (!uuid) {
            res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
            return;
        }

        // Get agent from registry
        const agent = this.getAgentFromRegistry(uuid);
        if (!agent) {
            res.status(404).json({ status: 'error', content: 'Agent not found.' });
            return;
        }

        // Load full history from file
        const fileUri = vscode.Uri.parse(agent.fileUri);
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

        res.json({
            status: 'ok',
            agent: {
                ...agent,
                childIds: Array.from(agent.childIds ?? [])
            },
            history
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
            const wsFolders = vscode.workspace.workspaceFolders;
            if (!wsFolders) {
                res.status(400).json({ status: 'error', content: 'No workspace folder open.' });
                return;
            }

            const root = wsFolders[0].uri;
            const agentDir = vscode.Uri.joinPath(root, '.mutsumi');

            // Create .mutsumi directory if it doesn't exist
            try {
                await vscode.workspace.fs.createDirectory(agentDir);
            } catch {
                // Directory may already exist
            }

            // Initialize rules
            await initializeRules(this.extensionUri, root);

            // Get all existing rules to initialize the agent with all rules enabled
            let allRules: string[] = [];
            try {
                const rulesDir = vscode.Uri.joinPath(root, '.mutsumi', 'rules');
                const entries = await vscode.workspace.fs.readDirectory(rulesDir);
                allRules = entries
                    .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                    .map(([name]) => name);
            } catch {
                // Ignore if rules dir doesn't exist yet
            }

            // Generate UUID for the new agent
            const uuid = uuidv4();
            const name = `agent-${Date.now()}.mtm `;
            const newFileUri = vscode.Uri.joinPath(agentDir, name);

            // Collect all workspace root URIs
            const allWorkspaceUris = vscode.workspace.workspaceFolders?.map(f => f.uri.toString()) || [root.toString()];

            // Read VS Code configuration to get default model
            const config = vscode.workspace.getConfiguration('mutsumi');
            const defaultModel = config.get<string>('defaultModel');

            // Create initial content with the generated UUID
            const agentContext: AgentContext = {
                metadata: {
                    uuid: uuid,
                    name: 'New Agent',
                    created_at: new Date().toISOString(),
                    parent_agent_id: null,
                    allowed_uris: allWorkspaceUris,
                    model: defaultModel || undefined,
                    contextItems: [],
                    activeRules: allRules
                },
                context: []
            };
            const initialContent = new TextEncoder().encode(JSON.stringify(agentContext, null, 2));

            // Write the file
            await vscode.workspace.fs.writeFile(newFileUri, initialContent);

            // Register the agent in the registry
            await AgentOrchestrator.getInstance().notifyNotebookDocumentOpened(uuid, newFileUri, agentContext.metadata);

            res.status(201).json({
                status: 'created',
                uuid: uuid,
                name: agentContext.metadata.name,
                fileUri: newFileUri.toString(),
                content: 'New agent created successfully.'
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

        // Get agent from registry
        const agent = this.getAgentFromRegistry(uuid);
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

        // Get agent from registry to get the actual file URI
        const agentInfo = this.getAgentFromRegistry(uuid);
        if (!agentInfo) {
            res.status(404).json({ status: 'error', content: 'Agent not found.' });
            return;
        }

        const fileUri = vscode.Uri.parse(agentInfo.fileUri);

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
