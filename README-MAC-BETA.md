# AIROOM Mac Beta 0.1.0-beta.2

基于 tonyAmadeus/offAice 上游提交 c6e2b59114763d83c93edeb2758a6cbe2ffbb952 的本地 macOS 适配。

## Beta.2：WorkBuddy 实验连接

在“设置与连接 → 连接与版本”的 WorkBuddy 实验连接中，填写开放平台 OAuth Access Token 后可检查本地助理在线状态、发送一句话测试并核对带随机标识的回复。令牌使用系统加密独立保存，不进入数据库或快照。

当前没有开发者应用授权，真实消息往返尚未验证。接口测试及桌面模拟测试已通过；本机已安装 WorkBuddy 5.8.3，但安装、登录桌面应用不等于取得开放平台授权。此版不开放 WorkBuddy 团队成员、并发任务、文件写回或自动令牌刷新。停止等待不会取消 WorkBuddy 中已投递的任务。[试验步骤与限制](docs/WorkBuddy-实验接入.md)。

## 运行条件与安装

- Apple 芯片 Mac（M1/M2/M3/M4 等 arm64），macOS 13 或以上。本版不提供 Intel 构建。
- 打开 `AIROOM-0.1.0-beta.2-macOS-arm64.dmg`，将 `AIROOM Mac Beta.app` 拖到“应用程序”，再打开应用。也可以完整解压 ZIP 后运行其中的应用。
- 随包附带标准 Node.js 26.6.0 和 npm，基础启动与执行端安装不需要你预装 Node.js；下载执行端和使用 AI 需要联网。
- 在“设置与连接 → 连接与版本”选择执行端，阅读厂商条款后下载、登录，再创建人物卡。
- 关闭窗口会保留后台运行，可从 Dock 或菜单栏唤回；按 Command-Q 完全退出。

本包使用本地临时签名（ad-hoc），没有 Apple Developer ID 签名或公证。如果系统提示无法验证开发者，可在“系统设置 → 隐私与安全性”对这一个已核对来源的应用选择“仍要打开”。无需关闭 Gatekeeper 或重置系统钥匙串。

## 已完成

- macOS arm64 的 `.app`、DMG、ZIP 打包，以及 Mac 运行依赖与 Node.js 的分发。
- Mac 应用菜单、编辑快捷键、Dock 唤回、窗口关闭到菜单栏。
- 独立 Beta 资料目录：`~/.airoom-mac-beta/data`；备份在同级 `backups`。不会自动迁入其他版本的聊天或登录信息。
- 密钥通过 Electron safeStorage 使用系统钥匙串保护；空白工作台不再提前请求钥匙串。启动测试使用真实系统 HOME，同时把应用数据和 AI 执行端账号目录分别隔离。
- 修复 POSIX 停止任务时父进程先退出、顽固子进程残留的问题；后台意外退出时清理已登记的进程组。
- 修复 Mac `/var` 与 `/private/var` 路径别名导致工作副本、还原点核对不一致的问题。

## 验证范围与限制

- 通过 TypeScript 类型检查和五项 Mac 专项测试：Unix npm 布局及空格路径、平台安装器筛选、顽固子进程停止、Mac 7zip 依赖打包、工作副本→确认写回→撤销及备份校验。
- Claude Code 2.1.292、Codex CLI 0.160.1、DeepSeek Harness 0.2.0-rc.2 已实际从官方 npm 源安装并通过隔离连接检查，正确返回未登录状态。
- 打包后桌面测试在仅含系统命令的 PATH 下完成：启动及后端就绪、内置 Node.js、原生菜单、Dock 唤回、真实安装 Codex、app-server 连接、备份及恢复预览、正常退出与重启保存连接。
- 文件任务链路使用本地测试执行端验证。没有使用你的真实账号，没有发送付费模型任务；真实账号登录、模型回复、多人协作和完整恢复流程仍需试用验收。
- Cursor、Qoder、Qoder CN、ZCode 的自动安装当前依赖 Windows 发行包，Mac Beta 已隐藏这些入口；手动 ACP 连接仍保留，具体 CLI 需自行验证。
- 系统强制结束整个应用、断电等异常情形下的进程清理尚未完整验证。
- 该版本用于本地试用，不包含自动更新或正式发行公证。

## 问题反馈

启动失败时可查看 `~/.airoom-mac-beta/data/startup.log`。请反馈出错步骤和提示内容；不要发送 API Key、登录令牌或整个 native 账号目录。

## GitHub 下载与构建

已发布文件位于 [xiaoouj/offAice-mac Releases](https://github.com/xiaoouj/offAice-mac/releases)。GitHub Actions 会从发布对应提交重新构建安装包，再生成该次构建的 SHA-256 校验文件；它与本地测试包的字节哈希可能不同。

发布工作流首次随提交运行；之后可在 Actions → Publish Mac Beta → Run workflow 手动运行。已公开的同名 Release 不会被覆盖。

## 从源码构建

使用官方 Node.js 26.6.0 的 darwin-arm64 发行版，校验 `UPSTREAM.json` 中记录的归档 SHA-256，将其 bin 目录加入当前终端 PATH。解压源码后执行：

```sh
npm ci --no-audit --no-fund
node node_modules/electron/install.js
npm run typecheck
npm run test:mac
npm run package:mac
node scripts/mac-desktop-smoke.mjs
```

构建结果位于 `release-mac/`。桌面测试保存在 `.test-cache/mac-desktop/`，使用独立测试资料，不复用日常账号。

原始代码与各 AI 执行端的许可、账号和服务条款仍以各自项目及厂商说明为准。
