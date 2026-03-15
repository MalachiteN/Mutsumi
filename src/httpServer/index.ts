import * as vscode from 'vscode';
import * as net from 'net';
import express = require('express');
import bodyParser = require('body-parser');
import { HeadlessAdapter } from '../adapters/headlessAdapter';
import { HttpServerOptions } from './types';
import { debugLogger } from '../debugLogger';

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
    handleCustom,
    handleListPending
} from './approval';

export { HttpServerOptions } from './types';

export class HttpServer {
    private readonly app = express();
    private server?: ReturnType<typeof this.app.listen>;
    private actualPort?: number;
    private readonly adapter: HeadlessAdapter;
    private readonly abortControllers = new Map<string, AbortController>();
    private readonly extensionUri: vscode.Uri;
    private readonly startPort: number;
    private readonly maxPort: number;

    constructor(adapter: HeadlessAdapter, extensionUri: vscode.Uri, options?: HttpServerOptions) {
        this.adapter = adapter;
        this.extensionUri = extensionUri;
        this.startPort = options?.port ?? 3000;
        this.maxPort = this.startPort + 100; // Try up to 100 ports
    }

    /**
     * Find an available port starting from startPort.
     */
    private findAvailablePort(): Promise<number> {
        return new Promise((resolve, reject) => {
            const tryPort = (port: number) => {
                if (port > this.maxPort) {
                    reject(new Error(`No available ports found between ${this.startPort} and ${this.maxPort}`));
                    return;
                }

                const server = net.createServer();
                
                server.once('error', (err: any) => {
                    if (err.code === 'EADDRINUSE') {
                        // Port is in use, try next
                        tryPort(port + 1);
                    } else {
                        reject(err);
                    }
                });

                server.once('listening', () => {
                    server.close(() => {
                        resolve(port);
                    });
                });

                server.listen(port, '127.0.0.1');
            };

            tryPort(this.startPort);
        });
    }

    async start(): Promise<void> {
        if (this.server) return;

        try {
            this.actualPort = await this.findAvailablePort();
            this.configureServer();
            this.server = this.app.listen(this.actualPort, '127.0.0.1', () => {
                const message = `已于 http://127.0.0.1:${this.actualPort} 启动服务器`;
                debugLogger.log(message);
            });
        } catch (error) {
            debugLogger.log(`[HttpServer] Failed to start: ${error}`);
            throw error;
        }
    }

    stop(): void {
        if (!this.server) return;
        this.server.close();
        this.server = undefined;
        this.actualPort = undefined;
    }

    getPort(): number | undefined {
        return this.actualPort;
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
            handleChat(req, res, this.adapter, this.abortControllers, this.extensionUri)
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
        this.app.get('/approval/pending', handleListPending);
        this.app.post('/approval/:id/approve', handleApprove);
        this.app.post('/approval/:id/reject', handleReject);
        this.app.post('/approval/:id/custom', handleCustom);
    }
}
