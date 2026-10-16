# WorkBuddy 本地助理实验连接

Beta.2 提供官方本地助理 API 的授权、在线检查及一句话往返测试。入口为“设置与连接 → 连接与版本 → WorkBuddy 实验连接”。尚未开放为团队执行端。

## 当前验证结果

- 已确认本机安装并运行 WorkBuddy 5.8.3。
- 桌面安装包附带的是专用精简执行引擎，不能将其 bin/codebuddy 直接用作独立 CodeBuddy CLI；未调用桌面内部 IPC 或读取其登录资料。
- 官方本地助理接口在无授权请求下返回 HTTP 401。本次没有开发者应用、Access Token 或真实模型调用。
- 六项自动接口测试通过，覆盖离线、过期授权、业务失败、响应格式、只确认本次随机回复、不泄露共享历史、投递不确定时不重发、超时、停止等待和更换令牌时丢弃旧响应。
- 隔离桌面测试通过：未配置状态、禁用测试、令牌加密保存、输入立即清空、快照不含令牌、重启恢复、清除授权、模拟官方接口的消息往返。

**这些测试确认实现和界面可用；真实 WorkBuddy 账号的消息往返、权限审批和计费尚未验证。**

## 获得授权后如何试用

1. 在 [WorkBuddy 开放平台](https://open.workbuddy.cn/)入驻，创建第三方应用。
2. 配置并获得 `user.localassistant.readable` 与 `user.localassistant.invokable` 授权；按照 [官方 OAuth / Open API 文档](https://open.workbuddy.cn/docs/openapi)获取用户 Access Token。应用 Client Secret 应由开发者服务端保管，本测试版不接收或打包它。
3. 打开并登录 WorkBuddy，确保该账号的本地助理在线。
4. 将 Access Token 填入 AIROOM 的 WorkBuddy 实验连接，点击“保存令牌”。不要把令牌放进聊天、Issue、截图或源码。
5. 点击“检查在线状态”：此步骤只读取状态，不发送模型任务。
6. 点击“发送一句话测试”，确认后发送一条要求只回复随机标识、不使用工具或文件的消息。此调用可能消耗账号额度，具体以 WorkBuddy 规则为准。
7. 只有在本次发送的消息 ID 之后收到带本次完整随机标识的助理文本，才显示“消息往返验证通过”。仅有 HTTP 200、发送成功或普通助理回复都不能通过。

令牌保存在 AIROOM 数据目录的 `secrets/workbuddy-access.secret`，由 Electron safeStorage 使用系统加密保护；不进入团队快照、资料数据库或普通备份。首次未配置时不会访问系统钥匙串。过期后请重新获取并保存，本版不自动刷新。

## 已知边界

- 本地助理接口指向账号的本地助理，未提供已验证的独立任务会话、明确完成事件和停止任务接口。因此当前只做单次连接测试，不接入多人调度、项目写回或自动后台任务。
- “停止等待”只结束 AIROOM 轮询；WorkBuddy 可能继续处理已投递的消息，请在其客户端核对。超时或发送响应丢失后不会自动重发。
- 只展示本次随机标识，不导入账号的其他聊天记录。测试结果不证明工具权限、文件边界、模型选择、账号额度或订阅复用已兼容。
- 本地助理操作经官方 HTTPS Open API 传输，沿用系统网络。现有显式 CLI 代理设置不作用于此实验入口。
- 正式的多人接入需要后续验证会话隔离、取消、权限审批及文件产物。云端 ACP 可作为另一路径，本版未实现。

## 从源码验证

```sh
npm run typecheck
npm run test:workbuddy
npm run build
node scripts/workbuddy-desktop-smoke.mjs
```

桌面脚本使用隔离 AIROOM 数据目录和测试令牌，在测试进程内模拟官方接口，不发送真实 WorkBuddy 请求或模型任务。输出位于 `.test-cache/workbuddy-desktop/`。
