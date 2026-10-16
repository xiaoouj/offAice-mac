新增 WorkBuddy 本地助理实验连接，适用于 Apple Silicon、macOS 13+。

在“设置与连接 → 连接与版本 → WorkBuddy 实验连接”中可保存开放平台 Access Token、检查在线状态并发送一句话测试。只有核对到本次完整随机标识的回复才显示往返通过。令牌通过系统加密保存在本机，不读取 WorkBuddy 桌面登录资料。

本次尚未取得 WorkBuddy 开发者应用授权，真实账号消息往返未验证。六项接口测试及隔离桌面模拟测试通过；后者验证了加密保存、重启读取、清除令牌和消息往返界面。无授权访问真实接口返回 401。

需要开发者应用及 user.localassistant.readable、user.localassistant.invokable 权限。当前不开放 WorkBuddy 团队成员、并发任务、文件写回、自动令牌刷新。停止等待只结束 AIROOM 轮询，不会取消 WorkBuddy 中已投递的消息。

保留 Beta.1 的 Mac 菜单、Dock 唤回、独立资料目录、内置 Node.js 和 Mac 路径及进程停止修复。安装包使用 ad-hoc 签名，未经过 Apple 公证；Intel Mac 暂不支持。打开 DMG 后将 AIROOM Mac Beta.app 拖入“应用程序”。

安装包由本提交构建；校验值见 SHA256SUMS.txt。试验步骤、官方文档和限制见 WorkBuddy-Experiment.md。WorkBuddy-Experiment-Results.json 区分真实接口观察与模拟测试。
