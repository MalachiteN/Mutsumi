# imagePasteProvider.ts

## 功能概述

ImagePasteProvider 实现了 VSCode 的 `DocumentPasteEditProvider` 接口，用于处理文档中的图片粘贴操作。

当用户将图片粘贴到文档中时，该类会：
1. 接收粘贴的图片数据（PNG 或 JPEG）
2. 将图片保存到系统临时目录的 `mutsumi_images` 文件夹
3. 在文档中插入 Markdown 格式的图片链接

## ImagePasteProvider 类

### 实现接口

```typescript
implements vscode.DocumentPasteEditProvider
```

### 构造函数

使用默认构造函数，无需额外参数。

### 方法

#### provideDocumentPasteEdits

提供文档粘贴编辑操作。

```typescript
async provideDocumentPasteEdits(
    document: vscode.TextDocument,
    ranges: readonly vscode.Range[],
    dataTransfer: vscode.DataTransfer,
    context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken
): Promise<vscode.DocumentPasteEdit[] | undefined>
```

**参数:**
- `document` - 目标文档
- `ranges` - 粘贴位置的区间数组
- `dataTransfer` - 剪贴板数据传输对象
- `context` - 粘贴编辑上下文
- `token` - 取消令牌

**返回值:**
- 粘贴编辑操作数组
- 如果不是图片数据则返回 `undefined`

**支持的图片格式:**
- `image/png`
- `image/jpeg`

**图片存储位置:**
系统临时目录下的 `mutsumi_images` 文件夹，例如：
- Windows: `%TEMP%/mutsumi_images/`
- Linux/macOS: `/tmp/mutsumi_images/`

**文件名格式:**
```
img_<时间戳>_<随机后缀>.<扩展名>
```
示例: `img_1234567890_abcdef.png`

**插入的Markdown格式:**
```markdown
![image](file:///tmp/mutsumi_images/img_1234567890_abcdef.png)
```

## 使用方式

在 `extension.ts` 中注册：

```typescript
vscode.languages.registerDocumentPasteEditProvider(
    { pattern: '**/*.md' },
    new ImagePasteProvider(),
    { pasteMimeTypes: ['image/png', 'image/jpeg'] }
);
```

## 工作流程

1. 检查剪贴板数据是否包含 `image/png` 或 `image/jpeg`
2. 获取图片数据并转换为文件
3. 确保 `mutsumi_images` 临时目录存在
4. 生成带时间戳和随机后缀的唯一文件名
5. 将图片写入临时文件
6. 构造 Markdown 图片链接
7. 返回文档粘贴编辑操作
