# CI 多平台构建与发布目标状态

## 目标
将 GitHub Actions 拆分为两个独立的 workflow：
1. **日常 CI**：所有 push/PR 到 `main` 分支时只运行 `check`（类型检查 + 编译）。
2. **发布 CI**：通过 `workflow_dispatch` 手动触发，构建 4 平台特定 VSIX + 1 个 universal VSIX，自动从 `package.json` 读取版本号创建 git tag，并发布 GitHub Release 上传所有 `.vsix` 文件。

不自动发布到 VS Code Marketplace（用户没有 Visa 卡无法开通 publisher 账户）。不自动修改 `package.json`。

## 决策结论

- **目标平台**：`win32-x64`、`darwin-arm64`、`linux-x64`、`linux-arm64`
- **日常产物**：无 VSIX，只验证类型和编译
- **发布产物**：
  - 4 个平台特定 VSIX
  - 1 个 universal VSIX
- **版本号来源**：从 `package.json` 自动读取，workflow 不接收输入参数
- **触发方式**：
  - 日常 CI：`push` / `pull_request` 到 `main`
  - 发布 CI：`workflow_dispatch` 手动点击触发
- **发布目标**：GitHub Release（不发布到 VS Code Marketplace）
- **package.json 更新**：由用户在本地手动完成，然后 push 到 main
- **Node 版本**：固定 `22.x`
- **WASM 处理**：发布 CI 中必须重新下载 `assets/tree-sitter/*.wasm`
- **中间产物清理**：universal 包构建完成后删除 `better-sqlite3-*` artifact，只保留最终 5 个 `.vsix` artifact
- **本次不做**：
  - 不发布到 VS Code Marketplace
  - 不支持 `darwin-x64`、`win32-arm64`、`linux-alpine` 等平台
  - 不自动 bump version
  - 不发 RC/alpha/beta 版本

## Workflow 结构

### `ci.yml`（日常检查）

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup node 22
      - npm ci
      - npm run check-types
      - npm run compile
```

### `release.yml`（手动发布）

```yaml
name: Release

on:
  workflow_dispatch:

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest
    steps:
      - checkout
      - setup node 22
      - npm ci
      - npm run check-types
      - npm run compile

  package:
    name: Package VSIX (${{ matrix.target }})
    needs: check
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            target: win32-x64
          - os: macos-latest
            target: darwin-arm64
          - os: ubuntu-latest
            target: linux-x64
          - os: ubuntu-24.04-arm
            target: linux-arm64
    steps:
      - checkout
      - setup node 22
      - npm ci
      - download WASM
      - npm run compile
      - npx @vscode/vsce package --target ${{ matrix.target }}
      - upload artifact mutsumi-${{ matrix.target }}
      - upload artifact better-sqlite3-${{ matrix.target }}

  package-universal:
    name: Package Universal VSIX
    needs: package
    runs-on: ubuntu-latest
    permissions:
      actions: write
      contents: read
    steps:
      - checkout
      - setup node 22
      - npm ci
      - download 4 个 better-sqlite3 artifact 并整理到 native/better-sqlite3/
      - download WASM
      - npm run compile
      - npx @vscode/vsce package
      - 安装 sqlite-vec 跨平台包
      - 解压 VSIX，注入 sqlite-vec 跨平台包
      - 删除 extension/node_modules/better-sqlite3/build/Release/better_sqlite3.node
      - 重新打包为 mutsumi-universal.vsix
      - upload artifact mutsumi-universal
      - delete intermediate better-sqlite3 artifacts

  release:
    name: Create Release
    needs: [package, package-universal]
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - checkout
      - read version from package.json
      - download all mutsumi-* artifacts
      - create git tag v{version}
      - create GitHub Release with softprops/action-gh-release
      - upload all .vsix files to release
```

## 发布流程

1. 用户在本地更新 `package.json` 的 `version` 字段
2. 用户 `git commit` 并 `git push` 到 `main`
3. 用户打开 GitHub Actions → `Release` workflow → 点击 `Run workflow`
4. CI 自动：
   - 运行 check
   - 构建 4 个平台特定 VSIX
   - 构建 universal VSIX
   - 从 `package.json` 读取版本号
   - 创建 tag `v{version}`
   - 创建 GitHub Release `Mutsumi v{version}`
   - 上传 5 个 `.vsix` 文件到 Release

## 读取 package.json 版本号的方法

```yaml
- name: Read version
  id: version
  run: echo "version=$(node -p \"require('./package.json').version\")" >> "$GITHUB_OUTPUT"

- name: Create tag and release
  uses: softprops/action-gh-release@v2
  with:
    tag_name: v${{ steps.version.outputs.version }}
    name: Mutsumi v${{ steps.version.outputs.version }}
    files: |
      artifacts/mutsumi-win32-x64/*.vsix
      artifacts/mutsumi-darwin-arm64/*.vsix
      artifacts/mutsumi-linux-x64/*.vsix
      artifacts/mutsumi-linux-arm64/*.vsix
      artifacts/mutsumi-universal/*.vsix
```

## 需要修改/新增的文件

| 文件 | 改动 |
|------|------|
| `.github/workflows/ci.yml`（新增） | 日常检查 workflow |
| `.github/workflows/release.yml`（新增） | 手动发布 workflow |
| `.github/workflows/build_and_package.yml` | 删除，功能拆分到 ci.yml 和 release.yml |
| `docs/ci-multiplatform-target.md` | 更新目标状态文档 |

## 验收标准

- [ ] `.github/workflows/ci.yml` 存在，push/PR 时只运行 check
- [ ] `.github/workflows/release.yml` 存在，workflow_dispatch 触发
- [ ] `release.yml` 中包含完整的 4 平台构建 + universal 包构建
- [ ] `release.yml` 从 `package.json` 自动读取版本号
- [ ] `release.yml` 创建 git tag `v{version}`
- [ ] `release.yml` 创建 GitHub Release 并上传 5 个 `.vsix`
- [ ] `release.yml` 中 universal 构建完成后删除 `better-sqlite3-*` 中间产物
- [ ] 不发布到 VS Code Marketplace
- [ ] 不自动修改 `package.json`
- [ ] 删除旧的 `.github/workflows/build_and_package.yml`
- [ ] 工作区无 YAML 诊断错误

## 风险

- `contents: write` 权限需要谨慎，只在 `release` job 上授予，避免日常 CI 拥有写权限
- tag 创建如果重复（例如 package.json 版本未更新就再次触发 release），GitHub Action 会报错。需要确保每次发布前都手动更新 package.json 版本
- `softprops/action-gh-release` 如果 tag 已存在且输入中没有设置，会报错。需要确保每次发布版本唯一

## 阶段边界

本阶段结束后，若需要可继续：
- 评估是否支持 `darwin-x64`（Intel Mac）恢复
- 评估是否支持 `win32-arm64` 或 `linux-alpine`
- 增加安装后 smoke test
