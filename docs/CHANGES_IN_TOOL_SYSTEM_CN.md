## 变更范围

### 涉及文件
- src/tools.d/permission.ts
- src/tools.d/tools/shell_exec.ts
- src/tools.d/tools/fs_write_ops.ts
- src/tools.d/tools/project_outline.ts

---

## src/tools.d/permission.ts

### 始状态
- 导出 requestApproval 函数，签名为 (actionDescription, targetUri, context, details?) => Promise<boolean>
- 无 handleRejectionFlow 函数
- requestApproval 内部使用 createStandardRequest，onReject 直接 resolve false
- 工具通过 if (!approved) 判断拒绝

### 终状态
- 新增导出 handleRejectionFlow 函数，签名为 (toolName, signalTermination?) => Promise<string>
  - 内部调用 vscode.window.showInputBox 获取拒绝理由
  - 若 reason 为 undefined 或空字符串，调用 signalTermination(false) 中断生成
  - 返回格式化拒绝消息，包含理由或仅标记为 Rejected
- requestApproval 签名变更为 (actionDescription, targetUri, context, toolName, details?) => Promise<string | null>
  - 新增 toolName 参数用于构造拒绝消息
  - 内部使用 createRequest 而非 createStandardRequest
  - onReject 回调调用 handleRejectionFlow 并 resolve 结果
  - 批准时返回 null，拒绝时返回拒绝消息字符串
- 保持 shouldAutoApprove 逻辑，自动批准时直接返回 null 不弹窗

---

## src/tools.d/tools/shell_exec.ts

### 始状态
- 调用 requestApproval 时传入 actionDescription, uriInput, context, details
- 接收 boolean 返回值
- 若 !approved，返回固定字符串 'User rejected the shell command execution.'

### 终状态
- 调用 requestApproval 时新增传入 toolName 参数 'shell'
- 接收 string | null 返回值
- 若返回值非 null（即 rejectionMsg），直接返回 rejectionMsg
- 移除固定的拒绝消息字符串

---

## src/tools.d/tools/fs_write_ops.ts

### mkdir 工具 - 始状态
- 调用 requestApproval('Create Directory (mkdir -p)', uriInput, context)
- 接收 boolean
- 若 !approved，返回 'User rejected the operation.'

### mkdir 工具 - 终状态
- 调用 requestApproval('Create Directory (mkdir -p)', uriInput, context, 'mkdir')
- 接收 string | null
- 若返回值非 null，直接返回该拒绝消息

### create_file 工具 - 始状态
- 调用 requestApproval('Create/Overwrite File', uriInput, context)
- 接收 boolean
- 若 !approved，返回 'User rejected the operation.'

### create_file 工具 - 终状态
- 调用 requestApproval('Create/Overwrite File', uriInput, context, 'create_file')
- 接收 string | null
- 若返回值非 null，直接返回该拒绝消息

---

## src/tools.d/tools/project_outline.ts

### 始状态
- 调用 requestApproval('Project Outline Scan', uriInput, context, details)
- 接收 boolean
- 若 !approved，返回 'User rejected the project outline scan.'

### 终状态
- 调用 requestApproval('Project Outline Scan', uriInput, context, 'project_outline', details)
- 接收 string | null
- 若返回值非 null，直接返回该拒绝消息

---

## 状态机变化

### 始状态拒绝流程
工具调用 requestApproval -> 用户点击拒绝 -> 立即 resolve(false) -> 工具返回固定拒绝消息 -> Agent 继续执行

### 终状态拒绝流程
工具调用 requestApproval -> 用户点击拒绝 -> 弹出 showInputBox -> 用户输入理由按回车 -> resolve(拒绝消息带理由) -> 工具返回给 Agent -> Agent 继续执行
或
工具调用 requestApproval -> 用户点击拒绝 -> 弹出 showInputBox -> 用户按 ESC -> 调用 signalTermination(false) 中断生成 -> resolve(基础拒绝消息) -> 工具返回 -> Agent 被中断

---

## 关键行为一致性

- 所有通过 requestApproval 的工具拒绝时都会弹出输入框
- ESC 或空输入触发中断生成（与 edit_file_* 行为一致）
- 有理由输入时不中断，仅传递理由给 LLM（与 edit_file_* 行为一致）
- 自动批准模式不弹窗直接通过（保持现有行为）
- edit_file_* 系列工具在第二步保持现状，使用自己的 onReject 回调