# AIROOM Mac Beta 0.1.0-beta.4

基于 tonyAmadeus/offAice 上游提交 c6e2b59114763d83c93edeb2758a6cbe2ffbb952 的本地 macOS 适配。

## Beta.3：聊天等待与网络提示

聊天等待新输出从固定 90 秒改为默认 300 秒，可在“设置与连接 → 工作台 → 聊天等待新输出（秒）”调整，范围 30–1800 秒。收到正文、思考摘要和工具进度后重新计时；等待用户回答时暂停；网络重连通知不延长计时，总运行时限仍然有效。

若 Codex 反复提示重连，请在“设置与连接 → 网络”选择实际可用的出口。仅开启系统 HTTP 代理不等于开启 TUN；此时应明确填写本机代理地址。本次本机问题在切换到现有显式代理后已收到真实 GPT 回复，更新不会自动改变其他用户的网络设置。旧结果未知的轮次不会自动重发，核对后可重新加入异常成员。

Beta.3 已移除 WorkBuddy 实验入口、令牌处理及测试接口。


## API 连接（Beta.4）

在“设置与连接 → 连接与版本 → 添加 API 连接”中，选择阶跃、DeepSeek、OpenAI、Gemini 预设，或手动填写基础地址、API Key 和模型 ID。支持 OpenAI Chat Completions 兼容接口及 Gemini 原生 Generate Content 接口；不需要安装命令行程序或进行浏览器账号登录。服务地址填写基础路径，如 `https://api.stepfun.com/v1`，不能携带密钥或查询参数。

保存后可直接创建人物卡。默认模型可以手动填写；也可在该 API 连接的“检查并读取模型”中读取列表，再在“设置”里选择。检查只调用模型列表接口，聊天才发送生成请求；不提供列表的服务允许使用手动模型。密钥通过本机 safeStorage 加密保存，修改地址或协议后需要重新输入密钥。API 额度和费用按服务商项目计算，与聊天订阅分别结算。

本版 API 成员支持文字聊天与团队讨论，不执行终端命令或读写文件，不支持图片或工具调用。仅提供 Responses 等其他协议的服务不兼容。网络使用工作台现有的系统网络 / 显式代理选项，本机回环服务直接访问。生成请求不会自动重发；遇到不完整流或中止会保留结果待核对。最大输出 Token 可设置为 128–32768。

自动验证使用隔离账号目录和本机模拟服务，覆盖两种协议的桌面填写、创建人物卡、真实流式网络往返、密钥加密、重启恢复。未持有真实 API Key，未验证任何厂商的真实账号、模型权限或计费。

## 运行条件与安装

- Apple 芯片 Mac（M1/M2/M3/M4 等 arm64），macOS 13 或以上。本版不提供 Intel 构建。
- 打开 `AIROOM-0.1.0-beta.4-macOS-arm64.dmg`，将 `AIROOM Mac Beta.app` 拖到“应用程序”，再打开应用。也可以完整解压 ZIP 后运行其中的应用。
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
