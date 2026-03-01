import type * as express from 'express';
import { approvalManager } from '../tools.d/permission';

/**
 * 处理批准请求
 * POST /approval/:id/approve
 */
export async function handleApprove(req: express.Request, res: express.Response): Promise<void> {
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
        await approvalManager.approveRequest(id);
        res.json({ status: 'ok', content: 'Action approve executed.' });
    } catch (e: any) {
        res.status(500).json({ status: 'error', content: e.message });
    }
}

/**
 * 处理拒绝请求
 * POST /approval/:id/reject
 */
export async function handleReject(req: express.Request, res: express.Response): Promise<void> {
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
        await approvalManager.rejectRequest(id);
        res.json({ status: 'ok', content: 'Action reject executed.' });
    } catch (e: any) {
        res.status(500).json({ status: 'error', content: e.message });
    }
}

/**
 * 处理自定义操作请求
 * POST /approval/:id/custom
 */
export async function handleCustom(req: express.Request, res: express.Response): Promise<void> {
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

    if (!request.customAction) {
        res.status(400).json({ status: 'error', content: 'No custom action available for this request.' });
        return;
    }

    try {
        await approvalManager.handleCustomAction(id);
        res.json({ status: 'ok', content: 'Action custom executed.' });
    } catch (e: any) {
        res.status(500).json({ status: 'error', content: e.message });
    }
}
