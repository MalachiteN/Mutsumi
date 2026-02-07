import OpenAI from 'openai';
import { AgentMessage } from './types';

/**
 * 将消息列表按 user prompt 划分成对话轮次
 * 每轮从 user 开始，到下一个 user 之前结束（最后一轮到列表末尾）
 * @param messages 完整消息历史
 * @returns 每一轮的消息数组
 */
function splitIntoRounds(messages: AgentMessage[]): AgentMessage[][] {
    const rounds: AgentMessage[][] = [];
    let currentRound: AgentMessage[] = [];

    for (const msg of messages) {
        if (msg.role === 'user') {
            // 遇到新的 user 消息，如果当前轮非空，则结束上一轮
            if (currentRound.length > 0) {
                rounds.push(currentRound);
            }
            // 开始新的一轮
            currentRound = [msg];
        } else {
            // assistant 或 tool 消息，加入当前轮
            currentRound.push(msg);
        }
    }

    // 最后一轮（可能是不完整的，但也算一轮）
    if (currentRound.length > 0) {
        rounds.push(currentRound);
    }

    return rounds;
}

/**
 * 根据对话上下文生成标题
 * @param messages 对话消息历史
 * @param apiKey OpenAI API Key
 * @param baseUrl OpenAI Base URL
 * @param model 使用的模型
 * @returns 生成的标题
 */
export async function generateTitle(
    messages: AgentMessage[],
    apiKey: string,
    baseUrl: string | undefined,
    model: string
): Promise<string> {
    const openai = new OpenAI({
        apiKey,
        baseURL: baseUrl,
        defaultHeaders: { 'Client-Name': 'Mutsumi-VSCode' }
    });

    // 按 user 分隔划分成对话轮次，取最近6整轮（或全部）
    const rounds = splitIntoRounds(messages);
    const recentRounds = rounds.length <= 6 ? rounds : rounds.slice(-6);
    const contextMessages = recentRounds.flat();

    // 将完整的上下文消息序列化为 JSON，保留所有字段（reasoning_content, tool_calls 等）
    const contextJson = JSON.stringify(contextMessages, null, 2);

    const response = await openai.chat.completions.create({
        model,
        messages: [
            {
                role: 'system',
                content: '请根据以下对话内容生成一个简短的标题，标题应该概括对话的主要内容。' +
                    '对话数据以 JSON 格式提供，包含 user、assistant、tool 等角色的消息，' +
                    'assistant 消息中可能包含 reasoning_content（思考过程）和 tool_calls（工具调用）。' +
                    '要求：\n1. 长度控制在10-20个字符\n2. 不要包含特殊符号如\\/:*?"<>|等' +
                    '\n3. 直接返回标题文本，不要有任何解释或前缀'
            },
            {
                role: 'user',
                content: `请为以下对话生成标题：\n\n${contextJson.substring(0, 4000)}` // 限制上下文长度
            }
        ],
        temperature: 0.7,
        max_tokens: 50
    });

    let title = response.choices[0]?.message?.content?.trim() || 'New Agent';
    
    // 清理标题中的非法字符
    title = sanitizeFileName(title);
    
    // 限制长度
    if (title.length > 30) {
        title = title.substring(0, 30);
    }
    
    return title || 'New Agent';
}

/**
 * 清理文件名中的非法字符
 * @param name 原始名称
 * @returns 清理后的名称
 */
export function sanitizeFileName(name: string): string {
    // 移除或替换 Windows/Unix 文件系统中的非法字符
    return name
        .replace(/[\\/:*?"<>|]/g, '-')  // 替换非法字符为 -
        .replace(/\s+/g, ' ')             // 合并多个空格
        .trim();
}

/**
 * 确保文件名唯一，如果已存在则添加数字后缀
 * @param baseName 基础文件名（不含扩展名）
 * @param existingNames 现有文件名列表
 * @returns 唯一的文件名
 */
export function ensureUniqueFileName(baseName: string, existingNames: string[]): string {
    if (!existingNames.includes(baseName)) {
        return baseName;
    }
    
    let counter = 1;
    let newName = `${baseName}-${counter}`;
    
    while (existingNames.includes(newName)) {
        counter++;
        newName = `${baseName}-${counter}`;
    }
    
    return newName;
}
