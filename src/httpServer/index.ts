import * as vscode from 'vscode';
import express = require('express');
import bodyParser = require('body-parser');
import { ToolManager } from '../tools.d/toolManager';
import { HeadlessAdapter } from '../adapters/headlessAdapter';
import { HttpServerOptions } from './types';

// Import endpoint handlers
import {
    createCreateAgentHandler,
    createListAgentsHandler
} from './agents';
import {
    handleGetAgent,
    handleDeleteAgent
} from './agent';
import { handleChat } from './chat';
import { handleSetModel } from './model';
import {
    handleListRules,
    handleGetRuleFile,
    handleSetRules
} from './rules';
import { handleStopAgent } from './stop';
import {
    handleApprove,
    handleReject,
    handleCustom
} from './approval';

export { HttpServerOptions } from './types';

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

    private configureServer(): void {
        this.app.use(bodyParser.json({ limit: '2mb' }));

        // Agents endpoints
        this.app.post('/agents', createCreateAgentHandler({ extensionUri: this.extensionUri }));
        this.app.get('/agents', createListAgentsHandler({}));

        // Agent endpoints
        this.app.get('/agent/:uuid', handleGetAgent);
        this.app.delete('/agent/:uuid', handleDeleteAgent);

        // Chat endpoint
        this.app.post('/agent/:uuid/chat', (req, res) =>
            handleChat(req, res, this.adapter, this.toolManager, this.abortControllers, this.extensionUri)
        );

        // Model endpoint
        this.app.put('/agent/:uuid/model', handleSetModel);

        // Rules endpoints
        this.app.get('/rules', handleListRules);
        this.app.get('/rules/:name', handleGetRuleFile);
        this.app.put('/agent/:uuid/rules', handleSetRules);

        // Stop endpoint
        this.app.post('/agent/:uuid/stop', (req, res) =>
            handleStopAgent(req, res, { adapter: this.adapter, abortControllers: this.abortControllers })
        );

        // Approval endpoints
        this.app.post('/approval/:id/approve', handleApprove);
        this.app.post('/approval/:id/reject', handleReject);
        this.app.post('/approval/:id/custom', handleCustom);
    }
}
