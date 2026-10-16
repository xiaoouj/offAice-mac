这是基于 tonyAmadeus/offAice 的首个 macOS Apple Silicon 测试版本。

适用：Apple 芯片（arm64）、macOS 13 或以上。打开 DMG 后将 AIROOM Mac Beta.app 拖入“应用程序”，或完整解压 ZIP 后运行。

改动：
- 提供 Mac 应用、DMG 和 ZIP，附带标准 Node.js 26.6.0 及 npm。
- 添加 Mac 应用菜单、编辑快捷键和 Dock 唤回。
- 使用独立资料目录 ~/.airoom-mac-beta，空白启动不提前访问钥匙串。
- 修复停止任务时顽固子进程残留，以及 Mac 路径别名导致的工作副本与撤销失败。
- 隐藏依赖 Windows 专用发行包的自动安装入口。

验证：
- 类型检查及 5 项 Mac 专项测试通过。
- Claude Code 2.1.292、Codex CLI 0.160.1、DeepSeek Harness 0.2.0-rc.2 的官方程序安装与未登录连接检查通过。
- 最终 DMG 挂载后完成启动、安装 Codex、备份预览、正常退出和重启测试。
- 文件写回与撤销使用本地测试执行端验证；未使用真实账号或发送付费模型任务。

限制：本测试版使用 ad-hoc 签名，未经 Apple Developer ID 签名或公证；Intel Mac 暂不支持。真实登录、模型任务和多人协作需要进一步验收。首次打开说明见 Mac-Beta-说明.md；无需关闭 Gatekeeper 或重置钥匙串。

安装包由 GitHub Actions 从本 Release 对应提交重新构建，文件哈希以本页附件 SHA256SUMS.txt 为准。包含安装包、源码、安装说明、本地测试结果和 SHA-256 校验文件。各 AI 执行端账号及服务条款由其厂商提供。
