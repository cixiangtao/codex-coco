# 外观模块普通启动可行性探索

2026-10-22。目标是判断能否继续点击原来的官方 Dock 图标启动 Codex，并自动应用三层图片布景。本文记录研究结果，不表示启动集成已经实现。

## 结论与适用范围

在当前“不修改官方应用包、不接管其他服务、不自动重启正在使用的客户端”的边界内，本轮没有找到可交付的“原 Dock 任意冷启动后无感注入”方案。

可以实现独立启动入口：用户一次性将 Codex Coco 的专用启动器固定到 Dock，后续点击该入口，由明确的启动流程带调试参数打开已选官方应用，并按用户保存的策略应用布景。这仍然是替换启动入口，不能宣传为原来的官方 Dock 图标、Finder 或 Spotlight 都已被透明接管；helper 尚未实现和安装，也没有验证 Dock 图标合并行为。

## 已核对的证据

### 1. 当前注入合同

`modules/appearance/launcher.ts` 只在明确操作时通过 `open -n -a` 启动目标并传递本机调试参数。`runtime.ts` 的应用操作直接连接已保存端口，注入不要求目标一定由 Codex Coco 启动。

因此，已有正确 CDP 的进程可以复用；完全退出后不带参数的普通启动，不会因为此前启动过一次而自动继承调试设置。自动恢复只负责已有通道上的连接和样式，不负责为外部进程开启调试。

### 2. 运行后开启主进程 Inspector：当前客户端关闭此入口

只读目标是本机安装的 `com.openai.codex`，版本 `26.1016.61520`、build `21421`，安装包名称为 `ChatGPT.app`。实际框架已改名为 `Codex Framework.framework`，REA 的标准 Electron 包路径自动识别没有匹配；解析真实文件路径后成功读取 fuse wire。

- REA Evidence：`ev_dcf4965cc1d8d59a9b9d2fcdb939914966486dec053192a47df469f6bc193534`。
- 框架文件 SHA-256：`86ac7a848d63a2d6e8e3afd405b39591748275eca479ac0919362a1955f4baf8`。
- arm64 slice，fuse wire version 1，sentinel 文件偏移 `224339666`，九个 fuse 完整读取。

| Fuse                                    | 当前观测 | 对本次方案的意义                               |
| --------------------------------------- | -------- | ---------------------------------------------- |
| `EnableNodeCliInspectArguments`         | disabled | 不能采用标准 Node Inspector / `SIGUSR1` 路径   |
| `EnableNodeOptionsEnvironmentVariable`  | disabled | 不能依赖 `NODE_OPTIONS` 注入主脚本             |
| `RunAsNode`                             | disabled | `ELECTRON_RUN_AS_NODE` 路径不受支持            |
| `EnableEmbeddedAsarIntegrityValidation` | enabled  | 应用代码受 ASAR 完整性校验                     |
| `OnlyLoadAppFromAsar`                   | enabled  | 不接受将旁置 `app/` 目录当成默认代码入口的方案 |

[Electron fuse 文档](https://www.electronjs.org/docs/latest/tutorial/fuses#nodecliinspect) 明确说明，关闭 Node Inspector fuse 也会关闭 `SIGUSR1` 开启主进程 Inspector 的能力；[源码](https://github.com/electron/electron/blob/main/shell/common/node_bindings.cc) 在该分支设置 `kNoStartDebugSignalHandler`。这是根据当前静态开关和官方实现作出的判断，没有向真实进程发送信号。

限制：这些开关不证明客户端不可能通过自身代码开放其他调试接口，也不等于禁用了显式 `--remote-debugging-port` 的 renderer CDP。没有枚举客户端全部内部 IPC、URL 路由或私有接口；客户端更新后须重新读取，不能将本次结果推广到所有版本。

### 3. macOS 的启动参数与通知边界

[Apple 的 `OpenConfiguration.arguments`](https://developer.apple.com/documentation/appkit/nsworkspace/openconfiguration/arguments) 作用于调用者发起的新实例启动请求，默认空数组；沙盒调用方设置的参数会被系统忽略。[`openApplication`](<https://developer.apple.com/documentation/appkit/nsworkspace/openapplication(at:configuration:completionhandler:)>) 可以明确启动所选应用，但文档没有给出为其他启动者设置永久 argv 的合同。

[`willLaunchApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/willlaunchapplicationnotification) 是 Finder 即将启动应用时的通知；[`didLaunchApplicationNotification`](https://developer.apple.com/documentation/appkit/nsworkspace/didlaunchapplicationnotification) 是应用启动时的通知。两者都公开应用身份，没有取消启动或替换参数的返回合同。不能将“提前收到通知”解释为可以拦截原 Dock 的启动请求，也不能把 willLaunch 笼统说成事后通知。

[Dock 文档](https://support.apple.com/guide/mac-help/open-apps-from-the-dock-mh35859/mac) 描述的是固定应用/项目的入口。独立 helper 是另一个目标；其图标能否与正在运行的官方应用自然合并，本轮没有实测，不作保证。未复制官方 bundle ID，也未修改 Dock 数据、LaunchAgents、全局环境或用户偏好。

这里的结论是“所核对的公开合同未提供支持”，不是对所有私有 API 或系统级方法作绝对不可能的证明。

### 4. 上游与官方外观能力

核对 Dream Skin 固定提交 `6fc42df48a6a5365011f55cc349e20c038e56d1d`：

- [`common-macos.sh`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/6fc42df48a6a5365011f55cc349e20c038e56d1d/macos/scripts/common-macos.sh#L886-L905) 的布景启动仍显式传递 CDP 参数；恢复普通启动的路径不传这些参数。
- [`window-readiness.test.mjs`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/6fc42df48a6a5365011f55cc349e20c038e56d1d/macos/tests/window-readiness.test.mjs#L243-L251) 区分首次调试启动与随后激活已运行实例。
- [`restart-cancellation.test.mjs`](https://github.com/Fei-Away/Codex-Dream-Skin/blob/6fc42df48a6a5365011f55cc349e20c038e56d1d/macos/tests/restart-cancellation.test.mjs#L138-L206) 验证重启取消和已运行实例的确认边界。

上游这部分实现没有建立透明接管原 Dock 冷启动的证据。本轮只阅读技术实现，没有复制其代码或素材；既有来源记录见 [来源与许可证](../THIRD_PARTY_NOTICES.md)。

OpenAI Docs 的 [Appearance 说明](https://learn.chatgpt.com/docs/reference/settings#appearance) 描述了原生主题、颜色与字体。该章节没有给出三层图片背景的扩展合同；不能把原生配色能力当成现有图片布景的完整替代，也不能仅凭这一章证明整个客户端不存在其他接口。

## 临时 Electron 实验

可复现脚本：[probe-appearance-startup.mjs](../scripts/research/probe-appearance-startup.mjs)。执行：

```sh
node scripts/research/probe-appearance-startup.mjs
```

实验使用项目依赖中的 Electron `44.9.2`，只启动本脚本创建的独立进程，四次共用同一临时 userData。主窗口隐藏，临时端口逐次确认空闲，采样十次后正常退出；异常时仅清理直接创建的独立进程组，结束删除临时数据。

| 场景                                       | 观测                                    |
| ------------------------------------------ | --------------------------------------- |
| 不带参数冷启动                             | 无 CDP 页面端点                         |
| 窗口完成加载后，主脚本追加调试参数         | 参数表能读回新值，但未开启 CDP 页面端点 |
| 明确携带调试参数启动                       | CDP 页面端点可用，正向对照通过          |
| 完全退出后，相同 userData 再次不带参数启动 | 仍无 CDP 页面端点，没有跨冷启动保留参数 |

这验证的是受控 Electron 进程，不是真实 Codex、原 Dock 鼠标点击或 macOS 所有启动途径的实测。端口未开启的观测范围是脚本采样窗口；就绪后的参数变化也不代表存在外部进程可调用的应用 API。真实安装包的安全开关证据与受控实验分别记录，不能相互冒充。

## 方案取舍与后续工作

| 方向                                       | 本轮判断                         | 后续需要验证或实现                                                                                                       |
| ------------------------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 保留原官方 Dock 图标、任意冷启动后直接注入 | 当前约束内未找到交付方案         | 如出现官方扩展或明确支持的启动接口，再重新评估                                                                           |
| 独立 Dock 启动入口                         | 可继续实现，需用户一次性替换入口 | 自有 bundle 身份、后台唤起、应用版本/路径校验、已有 CDP 复用、重启确认、失败反馈与卸载恢复；验证重复图标和 Dock 固定体验 |
| 开机预先带参数运行目标，再从 Dock 唤回窗口 | 只解决进程未完全退出的情况       | 额外常驻和登录启动均需独立选择；完全退出仍会失效，不能当作完整解决                                                       |
| 监听普通启动后退出并重启                   | 会打断工作流                     | 不作为无感方案；当前不自动执行                                                                                           |
| 改写官方应用包、fuse 或 ASAR，再重新签名   | 超出现有项目边界                 | 未进行实验；涉及签名、完整性和更新兼容，不作为默认方案                                                                   |

建议将“原 Dock 无感注入”保留为受限目标，先把独立入口设计成明确、可撤销的一次设置流程。它应复用现有 Electron 主进程的启动与模块合同，不在 helper 中复制一套布景引擎。已有普通进程时仍尊重重启确认；应用更新后重新识别所选官方包；关闭功能只恢复自有入口配置，不修改或覆盖官方应用。

本轮不安装 helper，不修改真实客户端或系统配置，不把研究脚本注册为常驻任务。
