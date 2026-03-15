import * as vscode from 'vscode';
import express = require('express');
import { AgentRunner } from '../agent/agentRunner';
import { MutsumiSerializer } from '../notebook/serializer';
import { createMainAgentToolSet, createSubAgentToolSet } from '../tools.d/toolManager';
import { getAgentFromRegistry } from './utils';
import type { HeadlessAdapter } from '../adapters/headlessAdapter';
import type { AgentSessionConfig } from '../adapters/interfaces';
import type { AgentMessage, AgentMetadata } from '../types';

export async function handleChat(
    req: express.Request,
    res: express.Response,
    adapter: HeadlessAdapter,
    abortControllers: Map<string, AbortController>,
    extensionUri: vscode.Uri
): Promise<void> {
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
    const agentInfo = getAgentFromRegistry(uuid);
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

    // Create appropriate tool set based on agent type
    const toolSet = isSubAgent ? createSubAgentToolSet() : createMainAgentToolSet();

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
    let session = adapter.getSession(uuid);
    if (!session) {
        session = await adapter.createSession({
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
    abortControllers.set(uuid, abortController);

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

                // Send SSE event with delta only
                const event = {
                    type: 'content',
                    content: delta
                };
                res.write(`data: ${JSON.stringify(event)}\n\n`);
            }
        };

        // Run the agent and stream results
        try {
            const runner = new AgentRunner(runnerOptions, toolSet, session);
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
            abortControllers.delete(uuid);
            // Restore original method
            session.replaceOutput = originalReplaceOutput;
        }
    } else {
        // Non-streaming mode: original behavior
        void (async () => {
            try {
                const runner = new AgentRunner(runnerOptions, toolSet, session!);
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
                abortControllers.delete(uuid);
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
