import * as vscode from 'vscode';
import type * as express from 'express';
import { AgentRegistry } from '../agent/registry';
import type { HeadlessAdapter } from '../adapters/headlessAdapter';

export interface StopAgentHandlerOptions {
  adapter: HeadlessAdapter;
  abortControllers: Map<string, AbortController>;
}

/**
 * Handle POST /agent/:uuid/stop
 * Stop agent generation by aborting the active controller
 */
export async function handleStopAgent(
  req: express.Request,
  res: express.Response,
  options: StopAgentHandlerOptions
): Promise<void> {
  const { adapter, abortControllers } = options;

  const uuidParam = req.params.uuid;
  const uuid = Array.isArray(uuidParam) ? uuidParam[0] : uuidParam;
  if (!uuid) {
    res.status(400).json({ status: 'error', content: 'Missing agent UUID.' });
    return;
  }

  // Check if there's an active abort controller for this agent
  const abortController = abortControllers.get(uuid);
  if (!abortController) {
    res.status(404).json({ status: 'error', content: 'No active generation found for this agent.' });
    return;
  }

  // Abort the generation
  abortController.abort();
  abortControllers.delete(uuid);

  // Also cancel the session's token to stop the agent loop
  const session = adapter.getSession(uuid);
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
