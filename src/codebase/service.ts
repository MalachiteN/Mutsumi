import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import Parser = require('web-tree-sitter');
import { EXT_TO_LANG, LANGUAGE_CONFIGS, LanguageConfig } from './definitions';

interface OutlineNode {
    type: string;
    name: string;
    startLine: number;
    endLine: number;
    children: OutlineNode[];
}

export class CodebaseService {
    private static instance: CodebaseService;
    private parsers: Map<string, Parser> = new Map();
    private languages: Map<string, Parser.Language> = new Map();
    private initialized = false;
    private context?: vscode.ExtensionContext;
    
    // 简单的内存缓存: uri -> outline root nodes
    private outlineCache: Map<string, OutlineNode[]> = new Map();

    private constructor() {}

    public static getInstance(): CodebaseService {
        if (!CodebaseService.instance) {
            CodebaseService.instance = new CodebaseService();
        }
        return CodebaseService.instance;
    }

    public async initialize(context: vscode.ExtensionContext) {
        if (this.initialized) return;
        this.context = context;

        try {
            await Parser.init();
            console.log('Tree-sitter initialized');
            this.initialized = true;
        } catch (e) {
            console.error('Failed to initialize tree-sitter:', e);
        }
    }

    private async getLanguage(langId: string): Promise<Parser.Language | null> {
        if (this.languages.has(langId)) return this.languages.get(langId)!;
        if (!this.context) return null;

        const config = LANGUAGE_CONFIGS[langId];
        if (!config) return null;

        // 从 assets/tree-sitter 目录加载
        const wasmPath = path.join(this.context.extensionPath, 'assets', 'tree-sitter', config.wasmName);
        
        try {
            if (!fs.existsSync(wasmPath)) {
                console.warn(`WASM file not found at ${wasmPath}`);
                return null;
            }
            const lang = await Parser.Language.load(wasmPath);
            this.languages.set(langId, lang);
            return lang;
        } catch (e) {
            console.error(`Failed to load language ${langId} from ${wasmPath}:`, e);
            return null;
        }
    }

    private async getParser(langId: string): Promise<Parser | null> {
        if (this.parsers.has(langId)) return this.parsers.get(langId)!;

        const lang = await this.getLanguage(langId);
        if (!lang) return null;

        const parser = new Parser();
        parser.setLanguage(lang);
        this.parsers.set(langId, parser);
        return parser;
    }

    /**
     * 生成文件大纲。
     * 如果缓存中有且文件未修改(这里暂时简化，每次请求都重新解析或基于简单的内存Map)，直接返回。
     * 实际生产中应监听文件变更事件来更新缓存。
     */
    public async getFileOutline(uri: vscode.Uri, content?: string): Promise<OutlineNode[] | null> {
        if (!this.initialized) return null;

        const ext = path.extname(uri.fsPath).toLowerCase();
        const langId = EXT_TO_LANG[ext];
        if (!langId) return null;

        const parser = await this.getParser(langId);
        if (!parser) return null;

        let fileContent = content;
        if (fileContent === undefined) {
            try {
                const bytes = await vscode.workspace.fs.readFile(uri);
                fileContent = new TextDecoder().decode(bytes);
            } catch (e) {
                return null;
            }
        }

        try {
            const tree = parser.parse(fileContent);
            const config = LANGUAGE_CONFIGS[langId];
            const nodes = this.extractNodes(tree.rootNode, config, fileContent);
            tree.delete(); // 释放内存
            
            // Update Cache
            this.outlineCache.set(uri.toString(), nodes);
            
            return nodes;
        } catch (e) {
            console.error(`Error parsing ${uri.fsPath}:`, e);
            return null;
        }
    }

    private extractNodes(node: Parser.SyntaxNode, config: LanguageConfig, source: string): OutlineNode[] {
        const results: OutlineNode[] = [];
        const cursor = node.walk();

        // 遍历子节点
        // 这里做一个简单的递归遍历。
        // 对于大型文件，可能需要优化遍历逻辑。
        
        // 这是一个深度优先遍历
        const traverse = (currentNode: Parser.SyntaxNode): OutlineNode | null => {
            const typeMap = config.definitions[currentNode.type];
            let processedNode: OutlineNode | null = null;

            if (typeMap) {
                // 这是一个我们关心的定义节点
                const name = this.getNodeName(currentNode, source);
                if (name) {
                    processedNode = {
                        type: typeMap,
                        name: name,
                        startLine: currentNode.startPosition.row,
                        endLine: currentNode.endPosition.row,
                        children: []
                    };
                }
            }

            // 检查是否有子节点需要递归
            // 只有当当前节点是 container，或者是根节点，或者是我们刚刚创建的 processedNode 时，才继续深入
            // 优化：如果当前节点既不是 container 也不是 definition，可能它只是一个包装器（比如 export_statement）
            // 如果是 export_statement，我们需要进入内部找 class/function
            
            // 简单策略：总是遍历子节点，但只在特定的节点类型下收集 children
            
            // 如果我们创建了一个节点(processedNode)，我们将把它的子节点加到它的 children 里
            // 如果没有创建，我们将把子结果返回给上层，让上层把它们扁平化加入列表（或者继续寻找）
            
            // 修正逻辑：
            // 我们不是返回单个 Node，而是返回 Node 列表。
            
            return processedNode;
        };

        // 重新实现一个非递归或简单的递归收集器
        // 目标是返回一棵 OutlineNode 树
        
        const collect = (currentNode: Parser.SyntaxNode): OutlineNode[] => {
            const nodes: OutlineNode[] = [];
            
            // 遍历所有直系子节点
            for (let i = 0; i < currentNode.childCount; i++) {
                const child = currentNode.child(i);
                if (!child) continue;

                const defType = config.definitions[child.type];
                
                if (defType) {
                    // 找到了一个定义 (Class, Func, etc.)
                    const name = this.getNodeName(child, source);
                    const newNode: OutlineNode = {
                        type: defType,
                        name: name || '<anonymous>',
                        startLine: child.startPosition.row,
                        endLine: child.endPosition.row,
                        children: []
                    };
                    
                    // 如果它是容器，递归查找子成员
                    if (config.containers.has(child.type)) {
                        newNode.children = collect(child);
                    }
                    
                    nodes.push(newNode);
                } else {
                    // 这不是一个定义，但它可能包含定义 (例如 export statement, 或者 block)
                    // 如果它是容器类型 (例如 program, 或者 export)，我们需要进去找
                    // 为了简化，如果不匹配 definitions，我们就看看它是不是有可能是包装器
                    // 大多数语言的 export 都是包装器
                    
                    // 宽泛策略：如果它有子节点，且不是一些显而易见的叶子（如 string, number），我们就进去看看
                    // 但为了性能，最好利用 config.containers
                    // 这里我们假设如果没命中 definition，但可能是结构性节点，就继续深入，把结果展平放到当前层级
                    
                    // 特殊处理: export_statement (JS/TS), public/private modifier (Java) 往往包裹着定义
                    // 如果当前节点类型包含 'declaration' 或 'statement' 或 'mod' 或 'export'，尝试深入
                    if (child.childCount > 0) {
                         // 简单的深度限制或类型过滤可以防止过度扫描
                         // 此时把子节点的结果提升上来
                         const childNodes = collect(child);
                         nodes.push(...childNodes);
                    }
                }
            }
            return nodes;
        };
        
        return collect(node);
    }

    private getNodeName(node: Parser.SyntaxNode, source: string): string | null {
        // 1. 尝试查找名为 'name' 的子字段
        const nameNode = node.childForFieldName('name');
        if (nameNode) {
            return nameNode.text;
        }

        // 2. 如果没有特定字段，尝试查找第一个 identifier 子节点
        for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child && (child.type === 'identifier' || child.type === 'type_identifier' || child.type === 'name')) {
                return child.text;
            }
        }
        
        // 3. 针对某些特定结构 (e.g. Variable Declarator in JS: `const x = 1`)
        // variable_declarator -> name: identifier
        // 上面的 fieldName check 应该能覆盖
        
        return null;
    }
    
    // 格式化输出
    public formatOutline(nodes: OutlineNode[], depth = 0): string {
        let output = '';
        const indent = '  '.repeat(depth);
        
        for (const node of nodes) {
            output += `${indent}- ${node.type} ${node.name}\n`;
            if (node.children.length > 0) {
                output += this.formatOutline(node.children, depth + 1);
            }
        }
        return output;
    }
}