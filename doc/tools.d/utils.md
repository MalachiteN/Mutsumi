# utils.ts

## 功能概述

`utils.ts` 是 `tools.d` 模块的通用工具函数集合，提供 URI 解析、访问控制、用户批准系统、编辑文件会话管理等核心功能。这些功能被多个工具模块共享使用。

---

## 核心功能

### 1. 用户批准系统

实现了完整的用户批准请求管理机制，用于控制危险操作（如文件写入、命令执行）。

#### `ApprovalRequest` 接口

```typescript
export interface ApprovalRequest {
    id: string;                    // 唯一标识符（UUID）
    actionDescription: string;     // 操作描述
    targetUri: string;             // 目标 URI
    details?: string;              // 额外详情
    timestamp: Date;               // 请求时间
    status: 'pending' | 'approved' | 'rejected';  // 状态
    resolve: (approved: boolean) => void;  // 解析函数
}
```

#### `ApprovalRequestManager` 类

单例模式实现的批准请求管理器。

**方法：**

| 方法 | 签名 | 描述 |
|------|------|------|
| `getInstance` | `static getInstance(): ApprovalRequestManager` | 获取单例实例 |
| `createRequest` | `createRequest(actionDescription, targetUri, details?): { id: string; promise: Promise<boolean> }` | 创建请求，返回 ID 和 Promise，允许在 await 前设置额外处理 |
| `addRequest` | `addRequest(action, targetUri, details?): Promise<boolean>` | 添加新请求，返回 Promise 等待用户响应（内部使用 createRequest） |
| `approveRequest` | `approveRequest(id: string): void` | 批准指定请求 |
| `rejectRequest` | `rejectRequest(id: string): void` | 拒绝指定请求 |
| `getPendingRequests` | `getPendingRequests(): ApprovalRequest[]` | 获取待处理请求 |
| `getAllRequests` | `getAllRequests(): ApprovalRequest[]` | 获取所有请求 |
| `getRequest` | `getRequest(id: string): ApprovalRequest \| undefined` | 获取指定请求 |

**`createRequest` 方法：**

```typescript
createRequest(
    actionDescription: string,
    targetUri: string,
    details?: string
): { id: string; promise: Promise<boolean> }
```

与 `addRequest` 不同，`createRequest` 返回包含 `id` 和 `promise` 的对象，允许在 await 之前执行额外设置：

```typescript
// 创建请求
const { id, promise } = approvalManager.createRequest(
    'Edit File',
    '/workspace/project/file.ts',
    'Will modify 5 lines'
);

// 在 await 前设置额外处理（如注册会话）
editFileSessionManager.addSession({
    id,
    filePath: '/workspace/project/file.ts',
    // ...
});

// 等待用户响应
const approved = await promise;
```

**使用示例：**

```typescript
// 简单场景：直接等待响应
const approved = await approvalManager.addRequest(
    'Create Directory',
    '/workspace/project/new-folder',
    'Will create: new-folder/subfolder'
);

if (approved) {
    // 执行操作
} else {
    // 用户拒绝
}

// 复杂场景：先获取 ID 再 await
const { id, promise } = approvalManager.createRequest(
    'Edit File',
    '/workspace/project/file.ts'
);
// 设置额外处理...
const approved = await promise;

// 在 UI 中批准/拒绝
approvalManager.approveRequest(requestId);
approvalManager.rejectRequest(requestId);
```

#### `requestApproval` 函数

工具使用的便捷函数，整合通知和批准流程。

```typescript
export async function requestApproval(
    actionDescription: string,  // 操作描述
    targetUri: string,          // 目标路径
    context: ToolContext,       // 工具上下文
    details?: string            // 额外详情
): Promise<boolean>
```

**执行流程：**

```
1. 使用 createRequest 创建请求，获取 ID 和 Promise
2. 在 Notebook 输出中显示等待信息
3. 显示 VS Code 通知（非模态），带有操作按钮
4. 等待用户响应（通过通知按钮或侧边栏）
5. 更新 Notebook 输出状态
6. 返回批准结果
```

**通知按钮：**

通知显示两个操作按钮：
- **✅ Approve**：批准请求
- **❌ Reject**：拒绝请求

用户可以通过点击通知按钮直接响应，或通过侧边栏的批准管理界面操作。

---

### 2. 编辑文件会话管理

管理文件编辑操作的会话状态，跟踪编辑生命周期（待处理 → 部分接受 → 已解决）。

#### `EditFileSession` 接口

```typescript
export interface EditFileSession {
    id: string;                    // 会话唯一标识符
    filePath: string;              // 目标文件路径
    originalUri: vscode.Uri;       // 原始文件 URI
    tempUri: vscode.Uri;           // 临时文件 URI
    toolName: string;              // 发起编辑的工具名称
    timestamp: number;             // 创建时间戳
    status: 'pending' | 'partially_accepted' | 'resolved';  // 会话状态
}
```

**状态说明：**

| 状态 | 值 | 描述 |
|------|-----|------|
| `pending` | `'pending'` | 会话待处理，等待用户审查 |
| `partially_accepted` | `'partially_accepted'` | 部分编辑已被用户接受 |
| `resolved` | `'resolved'` | 会话已完全解决（全部接受或拒绝） |

#### `EditFileSessionManager` 类

单例模式实现的编辑文件会话管理器。

**方法：**

| 方法 | 签名 | 描述 |
|------|------|------|
| `getInstance` | `static getInstance(): EditFileSessionManager` | 获取单例实例 |
| `addSession` | `addSession(session: Omit<EditFileSession, 'id'>): string` | 添加会话，生成并返回 ID |
| `markPartiallyAccepted` | `markPartiallyAccepted(id: string): void` | 标记会话为部分接受状态 |
| `resolveSession` | `resolveSession(id: string): void` | 标记会话为已解决状态 |
| `getSession` | `getSession(id: string): EditFileSession \| undefined` | 获取指定会话 |
| `getActiveSessions` | `getActiveSessions(): EditFileSession[]` | 获取所有活动会话（pending 或 partially_accepted） |
| `getAllSessions` | `getAllSessions(): EditFileSession[]` | 获取所有会话 |
| `removeSession` | `removeSession(id: string): void` | 移除指定会话 |

**事件：**

```typescript
onDidChangeSessions: vscode.Event<EditFileSession[]>
```

会话列表发生变化时触发。

**使用示例：**

```typescript
// 获取管理器实例
const sessionManager = EditFileSessionManager.getInstance();

// 创建新会话
const sessionId = sessionManager.addSession({
    filePath: '/workspace/project/file.ts',
    originalUri: vscode.Uri.file('/workspace/project/file.ts'),
    tempUri: vscode.Uri.file('/workspace/project/.mutsumi-temp/file.ts'),
    toolName: 'edit_file_search_replace',
    timestamp: Date.now(),
    status: 'pending'
});

// 用户部分接受编辑
sessionManager.markPartiallyAccepted(sessionId);

// 用户完全解决（接受或拒绝全部）
sessionManager.resolveSession(sessionId);

// 监听会话变化
sessionManager.onDidChangeSessions((sessions) => {
    console.log(`Active sessions: ${sessions.length}`);
});
```

#### `editFileSessionManager` 导出

```typescript
export const editFileSessionManager: EditFileSessionManager
```

预实例化的编辑文件会话管理器单例，可直接导入使用。

---

### 3. URI 解析

#### `resolveUri` 函数

将各种格式的输入解析为标准 VS Code URI。

```typescript
export function resolveUri(input: string): vscode.Uri
```

**支持的输入格式：**

| 格式 | 示例 | 处理方式 |
|------|------|----------|
| URI 格式 | `file:///home/user/file.txt` | 直接解析 |
| 绝对路径（Unix） | `/home/user/file.txt` | 转换为文件 URI |
| 绝对路径（Windows） | `C:\Users\file.txt` | 转换为文件 URI |
| 相对路径 | `src/main.ts` | 相对于工作区根目录 |

**解析规则：**

```typescript
// URI 格式（scheme://）
if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input)) {
    return vscode.Uri.parse(input);
}

// 绝对路径
if (input.startsWith('/') || /^[a-zA-Z]:[\\\/]/.test(input)) {
    return vscode.Uri.file(input);
}

// 相对路径 → 工作区根目录
if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    const root = vscode.workspace.workspaceFolders[0].uri;
    // 拼接路径
}
```

---

### 4. 访问控制

#### `checkAccess` 函数

验证目标 URI 是否在允许的 URI 列表中。

```typescript
export function checkAccess(
    targetUri: vscode.Uri, 
    allowedUris: string[]
): boolean
```

**匹配逻辑：**

1. **根目录权限**：如果 `allowedUris` 包含 `/`，允许所有访问
2. **精确匹配**：路径完全匹配
3. **目录包含**：目标路径在允许的目录内

**示例：**

```typescript
// allowedUris = ['/workspace/project/src']

// 允许（在目录内）
checkAccess(Uri.file('/workspace/project/src/utils.ts'), allowedUris); // true

// 允许（精确匹配）
checkAccess(Uri.file('/workspace/project/src'), allowedUris); // true

// 拒绝（不在目录内）
checkAccess(Uri.file('/workspace/other/file.ts'), allowedUris); // false
```

**路径标准化：**

```typescript
const targetPath = path.normalize(targetUri.fsPath).toLowerCase();
const normalizedAllowed = path.normalize(allowedPath).toLowerCase();
```

---

### 5. 其他工具函数

#### `getUriKey` 函数

获取 URI 的键值（用于 Map 等数据结构）。

```typescript
export function getUriKey(uri: vscode.Uri): string
```

- `file` scheme：返回 `fsPath`
- 其他 scheme：返回 `toString()`

#### `isCommonIgnored` 函数

检查文件名是否应该被忽略（常用于目录遍历）。

```typescript
export function isCommonIgnored(name: string): boolean
```

**忽略列表：**

```typescript
const COMMON_IGNORED = new Set([
    'node_modules', '.git', '.vscode', 
    'dist', 'out', 'build', '__pycache__', 'coverage'
]);
```

**判断逻辑：**

```typescript
return name.startsWith('.') || COMMON_IGNORED.has(name);
```

---

## 依赖关系

| 依赖 | 用途 |
|------|------|
| `vscode` | VS Code API |
| `path` | 路径处理和标准化 |
| `uuid` | 生成批准请求唯一标识符 |
| `interface.ts` | `ToolContext` 类型 |

---

## 使用示例

### 完整的访问控制流程

```typescript
import { resolveUri, checkAccess, requestApproval } from './utils';

async function dangerousOperation(args: any, context: ToolContext) {
    // 1. 解析 URI
    const uri = resolveUri(args.uri);
    
    // 2. 检查访问权限
    if (!checkAccess(uri, context.allowedUris)) {
        return `Access Denied: Cannot access ${uri}`;
    }
    
    // 3. 请求用户批准
    const approved = await requestApproval(
        'Delete File',
        args.uri,
        context,
        'This action cannot be undone'
    );
    
    if (!approved) {
        return 'User rejected the operation';
    }
    
    // 4. 执行操作
    await vscode.workspace.fs.delete(uri);
    return 'File deleted successfully';
}
```

### 编辑文件会话完整流程

```typescript
import { 
    approvalManager, 
    editFileSessionManager 
} from './utils';

async function editFileWithSession(args: any, context: ToolContext) {
    // 1. 创建批准请求
    const { id, promise } = approvalManager.createRequest(
        'Edit File',
        args.uri,
        'Will apply search/replace edits'
    );
    
    // 2. 注册编辑会话
    editFileSessionManager.addSession({
        filePath: args.uri,
        originalUri: resolveUri(args.uri),
        tempUri: resolveUri(args.tempUri),
        toolName: 'edit_file_search_replace',
        timestamp: Date.now(),
        status: 'pending'
    });
    
    // 3. 等待用户批准
    const approved = await promise;
    
    if (approved) {
        // 4a. 用户批准，应用编辑
        await applyEdits(args);
        editFileSessionManager.resolveSession(id);
    } else {
        // 4b. 用户拒绝，清理
        editFileSessionManager.removeSession(id);
    }
    
    return approved ? 'Edits applied' : 'Edits rejected';
}
```

### 过滤目录遍历

```typescript
import { isCommonIgnored } from './utils';

async function listDirectory(uri: vscode.Uri) {
    const entries = await vscode.workspace.fs.readDirectory(uri);
    
    // 过滤忽略的文件
    const filtered = entries.filter(([name, type]) => {
        return !isCommonIgnored(name);
    });
    
    return filtered;
}
```

---

## 系统架构

### 批准系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Tool (如 mkdirTool)                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│              requestApproval() 函数                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 1. 使用 createRequest() 获取 ID 和 Promise         │  │
│  │ 2. 在 Notebook 输出中显示等待信息                   │  │
│  │ 3. 显示 VS Code 通知（带 ✅/❌ 按钮）               │  │
│  │ 4. 等待 Promise 解析                                │  │
│  │ 5. 更新 Notebook 输出状态                           │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│           ApprovalRequestManager (单例)                  │
│  ┌───────────────────────────────────────────────────┐  │
│  │ - createRequest(): 返回 {id, promise}             │  │
│  │ - 维护 requests Map                               │  │
│  │ - 生成 UUID                                       │  │
│  │ - 触发 onDidChangeRequests 事件                    │  │
│  │ - 管理请求生命周期                                 │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   Mutsumi 侧边栏 UI                      │
│         (显示待处理请求，提供批准/拒绝按钮)               │
│         或 VS Code 通知按钮（✅ Approve / ❌ Reject）    │
└─────────────────────────────────────────────────────────┘
```

### 编辑会话管理架构

```
┌─────────────────────────────────────────────────────────┐
│                  edit_file 工具                          │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│         approvalManager.createRequest()                  │
│                   ↓ 返回 {id, promise}                   │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│       editFileSessionManager.addSession()                │
│  ┌───────────────────────────────────────────────────┐  │
│  │ 注册会话：id, filePath, originalUri, tempUri       │  │
│  │ status: 'pending'                                 │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│       EditFileSessionManager (单例)                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ - sessions: Map<string, EditFileSession>          │  │
│  │ - addSession(), markPartiallyAccepted()           │  │
│  │ - resolveSession(), removeSession()               │  │
│  │ - onDidChangeSessions 事件                        │  │
│  └───────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────┐
│                   CodeLens 提供器                        │
│              (显示会话状态，提供操作按钮)                 │
└─────────────────────────────────────────────────────────┘
```

---

## 注意事项

1. **单例模式**：`ApprovalRequestManager` 和 `EditFileSessionManager` 都是单例，全局只有一个实例
2. **状态清理**：批准/拒绝后请求会在 1 秒后自动从管理器中移除
3. **路径大小写**：Windows 系统不区分大小写，匹配时会统一转换为小写
4. **相对路径**：`resolveUri` 需要工作区根目录才能解析相对路径
5. **并发处理**：批准系统支持并发请求，每个请求有独立的状态和 Promise
6. **会话生命周期**：编辑文件会话从 `pending` → `partially_accepted`（可选）→ `resolved`，完成后应及时清理
