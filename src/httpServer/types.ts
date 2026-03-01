import * as vscode from 'vscode';
import express = require('express');
import { HeadlessAdapter } from '../adapters/headlessAdapter';

export interface HttpServerOptions {
    port?: number;
}

/**
 * Context object passed to endpoint handler functions.
 */
export interface EndpointContext {
    app: express.Application;
    adapter: HeadlessAdapter;
    extensionUri: vscode.Uri;
    abortControllers: Map<string, AbortController>;
}
