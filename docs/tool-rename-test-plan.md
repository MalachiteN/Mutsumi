# 工具改名与合并 —— 测试方案

> **本文档读者**：一个全新会话中的 Mutsumi agent（下称"测试者"）。你不需要任何历史对话上下文，严格按本文档步骤执行即可。
> **测试对象**：刚完成的工具改名与合并工程。新工具集为 `read`（含可选 `range` 行范围参数）、`write`、`edit`、`grep`、`glob`、`find_filename`、`diagnostics`（另有未改名的 `shell`、`mkdir` 等）。
> **目标**：验证改名后的工具可正常解析与执行，两个合并工具（`grep`、`glob`）的行为契约全部满足，错误处理诚实（不得谎报"用户终止"）。

---

## 0. 前提条件

执行任何用例前，逐项确认：

1. **扩展已用最新代码构建**：仓库根目录 `npm run compile` 退出码 0。
2. **扩展已重载**：在 Extension Development Host 中重新加载（或重新打包安装），使新工具定义生效。
3. **测试会话类型**：你必须是 **implementer** 类型（拥有 `read` + `deliver` 工具集）的会话。`chat` 类型没有任何工具，不能用于本测试。
4. **自动批准**：`write` 和 `edit` 会触发人工批准弹窗。为避免每个用例都人工点击，建议测试前执行命令面板 `Mutsumi: Enter Auto-Approve` 开启自动批准；若不开启，请在每次弹窗时手动批准。
5. **工作目录**：所有相对路径均以**仓库根目录**为基准解析。

---

## 1. 测试夹具搭建（Phase 0）

**目的**：建立内容完全已知的文件树，使所有断言可精确比对。

### 1.1 创建目录结构

调用 `shell`（PowerShell）：

```powershell
New-Item -ItemType Directory -Force ".mtm-test-fixtures", ".mtm-test-fixtures/subdir", ".mtm-test-fixtures/empty"
```

**预期**：命令成功执行，无错误输出。

### 1.2 写入夹具文件

> 注意：此步骤同时是对 `write` 工具的冒烟测试。若某次 `write` 失败，直接记录 FAIL 并继续。

**文件 A** — 调用 `write`：

```json
{
  "uri": ".mtm-test-fixtures/hello.txt",
  "new_content": "Hello, Mutsumi!\nThis is a test file.\nEnd of file.\n"
}
```

**文件 B** — 调用 `write`（行内容设计为：MARKER_ONE 出现在第 3、8 行，MARKER_TWO 出现在第 5 行）：

```json
{
  "uri": ".mtm-test-fixtures/search_target.txt",
  "new_content": "alpha line one\nbeta line two\ngamma MARKER_ONE delta\nepsilon line four\nzeta MARKER_TWO eta\ntheta line six\niota line seven\nkappa MARKER_ONE lambda\nomega line nine\n"
}
```

**文件 C** — 调用 `write`：

```json
{
  "uri": ".mtm-test-fixtures/subdir/nested.txt",
  "new_content": "nested file with MARKER_ONE inside\n"
}
```

**预期**：三次调用均返回成功（非 Error 开头的消息）。

---

## 2. 测试用例

> **记录方式**：每执行完一个用例，立即在第 4 节的结果表中填写实际输出（原文照录，不要概括）与 PASS/FAIL。
> **判定通则**：输出以 `Error` 开头表示工具执行失败；除明确标注"预期报错"的用例外，收到 `Error` 一律 FAIL。路径分隔符 `/` 与 `\` 的差异不视为失败。

### Phase 1：读取工具

---

#### T01 — `read` 基本读取

**调用**：`read`

```json
{ "uri": ".mtm-test-fixtures/hello.txt" }
```

**预期**：输出精确为

```
Hello, Mutsumi!
This is a test file.
End of file.
```

（可含末尾空行差异）

---

#### T02 — `read` 行范围读取（`range` 参数）

**调用**：`read`

```json
{ "uri": ".mtm-test-fixtures/hello.txt", "range": [2, 3] }
```

**预期**：输出精确为

```
2: This is a test file.
3: End of file.
```

---

#### T03 — `read` 越界范围

**调用**：`read`

```json
{ "uri": ".mtm-test-fixtures/hello.txt", "range": [99, 100] }
```

**预期**：输出为 `(Range invalid or out of bounds)`。**预期报错类消息，非 Error。**

---

### Phase 2：纯改名写入工具

---

#### T04 — `edit` 查找替换

**调用**：`edit`

```json
{
  "uri": ".mtm-test-fixtures/hello.txt",
  "search_replace": "This is a test file.",
  "new_content": "This is a modified file."
}
```

**随后立即验证** — 调用 `read`：

```json
{ "uri": ".mtm-test-fixtures/hello.txt" }
```

**预期**：`edit` 返回成功；`read` 输出第二行为 `This is a modified file.`，其余行不变。

---

#### T05 — `edit` 搜索内容不存在（错误路径）

**调用**：`edit`

```json
{
  "uri": ".mtm-test-fixtures/hello.txt",
  "search_replace": "NO_SUCH_STRING_12345",
  "new_content": "anything"
}
```

**预期**：返回以 `Error:` 开头的消息，且包含 `Could not find the search content`。**此为预期报错，判定为 PASS 的条件是收到该错误而非崩溃或其他消息。**

---

#### T06 — `write` 覆盖已存在文件

**调用**：`write`

```json
{
  "uri": ".mtm-test-fixtures/hello.txt",
  "new_content": "overwritten\n"
}
```

**随后立即验证** — 调用 `read`：

```json
{ "uri": ".mtm-test-fixtures/hello.txt" }
```

**预期**：`write` 返回成功；`read` 输出仅为 `overwritten`（旧内容完全消失）。**注意：此用例会销毁 T04 的修改，属预期行为。**

---

### Phase 3：`grep` 合并工具

---

#### T07 — `grep` 单文件模式（无上下文）

**调用**：`grep`

```json
{ "uri": ".mtm-test-fixtures/search_target.txt", "keyword": "MARKER_ONE" }
```

**预期**：输出恰好包含 **2 条**匹配行，格式为 `path:line:content`：

- 一条含 `:3:` 且内容含 `gamma MARKER_ONE delta`
- 一条含 `:8:` 且内容含 `kappa MARKER_ONE lambda`
- 路径部分指向 `search_target.txt`

不得包含其他行号。

---

#### T08 — `grep` 单文件模式（带上下文，区域分隔）

**调用**：`grep`

```json
{ "uri": ".mtm-test-fixtures/search_target.txt", "keyword": "MARKER_ONE", "lines_before": 1, "lines_after": 1 }
```

**预期**：

- 输出包含两个上下文区域：第一个覆盖第 2–4 行，第二个覆盖第 7–9 行；
- 两个区域之间恰好出现 **1 个** `...` 分隔符；
- 两个区域不重叠（第 4 行与第 7 行之间没有第 5、6 行内容——即输出中**不得**出现 `zeta MARKER_TWO eta` 和 `theta line six`）。

---

#### T09 — `grep` 目录模式

**调用**：`grep`

```json
{ "uri": ".mtm-test-fixtures", "keyword": "MARKER_ONE" }
```

**预期**：输出恰好包含 **3 条**匹配行：

- `search_target.txt` 的第 3 行和第 8 行；
- `subdir/nested.txt` 的第 1 行（路径中须能看出位于 subdir 下）。

不得出现 `hello.txt` 的匹配（它不含该关键词）。

---

#### T10 — `grep` 路径不存在（错误诚实性，重点）

**调用**：`grep`

```json
{ "uri": ".mtm-test-fixtures/does-not-exist.txt", "keyword": "anything" }
```

**预期**：

- 返回以 `Error` 开头的消息，且包含 `Cannot access path`；
- **关键否定断言**：输出中**不得**包含 `[Interrupted]` 或 `forcibly stopped`。出现即为 FAIL（这是本次工程修复的核心 bug：参数错误曾被谎报为"用户终止"）。

---

#### T11 — `grep` 无匹配

**调用**：`grep`

```json
{ "uri": ".mtm-test-fixtures/search_target.txt", "keyword": "NO_SUCH_KEYWORD_67890" }
```

**预期**：返回包含 `No matches found` 的消息，非 Error。

---

### Phase 4：`glob` 合并工具

---

#### T12 — `glob` 文件模式

**调用**：`glob`

```json
{ "uri": ".mtm-test-fixtures/search_target.txt" }
```

**预期**：输出匹配格式 `Size: <数字> KB (<数字> bytes)`，且 bytes 数字大于 0。

---

#### T13 — `glob` 目录模式

**调用**：`glob`

```json
{ "uri": ".mtm-test-fixtures" }
```

**预期**：

- 输出中包含 `subdir` 和 `empty` 两个 `[DIR ]` 条目；
- 包含 `hello.txt`、`search_target.txt` 等 `[FILE]` 条目，且每个文件条目带有大小信息（含 `KB` 字样）；
- 目录条目排在文件条目之前；
- **Windows 环境**：条目中**不得**出现 `rwx` 样式的权限标志位（权限位仅 POSIX 显示）。

---

#### T14 — `glob` 空目录

**调用**：`glob`

```json
{ "uri": ".mtm-test-fixtures/empty" }
```

**预期**：输出为 `(Empty Directory)`。

---

#### T15 — `glob` 路径不存在（错误诚实性，重点）

**调用**：`glob`

```json
{ "uri": ".mtm-test-fixtures/does-not-exist" }
```

**预期**：

- 返回以 `Error` 开头的消息，且包含 `Cannot access path`；
- **关键否定断言**：输出中**不得**包含 `[Interrupted]` 或 `forcibly stopped`。

---

### Phase 5：其余纯改名工具

---

#### T16 — `find_filename` 文件名搜索

**调用**：`find_filename`

```json
{ "uri": ".mtm-test-fixtures", "name_includes": "search_target" }
```

**预期**：输出中包含 `search_target.txt` 的路径。

---

#### T17 — `diagnostics` 诊断获取

**调用**：`diagnostics`（不带参数或 `uri` 省略）

```json
{}
```

**预期**：工具正常返回一个字符串（工作区无问题时为"无问题"类消息，有问题时为诊断列表）。**判定标准仅为不崩溃、不返回执行异常**；内容不设断言。

---

## 3. 清理（Phase 6）

全部用例执行完毕后（无论成败），调用 `shell`：

```powershell
Remove-Item -Recurse -Force ".mtm-test-fixtures"
```

**预期**：目录被删除。随后可执行命令面板 `Mutsumi: Exit Auto-Approve` 恢复审批设置（如果测试前开启过）。

---

## 4. 结果记录表

| 用例 | 工具 | 预期摘要 | 实际输出（原文照录） | 结果 |
|---|---|---|---|---|
| T01 | read | 精确读取 3 行 | | |
| T02 | read | 第 2-3 行带行号 | | |
| T03 | read | 越界提示 | | |
| T04 | edit | 替换成功且验证一致 | | |
| T05 | edit | 报 Could not find | | |
| T06 | write | 覆盖成功且旧内容消失 | | |
| T07 | grep | 文件模式 2 条匹配 | | |
| T08 | grep | 上下文区域+1个`...` | | |
| T09 | grep | 目录模式 3 条匹配 | | |
| T10 | grep | 报错且无[Interrupted] | | |
| T11 | grep | No matches found | | |
| T12 | glob | Size: X KB (Y bytes) | | |
| T13 | glob | 目录列表带大小无权限位 | | |
| T14 | glob | (Empty Directory) | | |
| T15 | glob | 报错且无[Interrupted] | | |
| T16 | find_filename | 找到 search_target.txt | | |
| T17 | diagnostics | 正常返回 | | |

## 5. 执行纪律

1. **按顺序执行**：夹具未建好前不得跳过 Phase 0 直接跑用例。
2. **照录输出**：实际输出栏必须原文照录，不得凭印象填写。
3. **失败不中断**：某个用例 FAIL 时记录后继续下一个，全部跑完后统一汇总。
4. **只测不修**：测试者的职责是验证与报告。发现 FAIL **不得**修改项目源代码"修复"它，只需在最终报告中给出实际输出与预期差异。
5. **最终报告格式**：

```
测试完成：PASS X/17，FAIL Y/17
失败用例：[列表，每个含实际输出与预期差异分析]
建议：[可选]
```
