# Codex Coco

一个按自己习惯打磨的 Codex 桌面伴侣。

[English](README.md)

Codex Coco 将用量、外观和系统偏好放进一个 Electron 应用，为更多模块保留独立生命周期、配置和界面入口。个人使用习惯、学习与持续打磨是项目的出发点。

**当前状态：二期核心功能已接入的本地开发版。** 源码已开源；已发布 [0.1.0-preview.1](https://github.com/cixiangtao/codex-coco/releases/tag/v0.1.0-preview.1) 自签名预览版，仅支持 macOS Apple Silicon。没有使用 Apple Developer ID 或公证。真实账号、真实 Codex 版本、系统登录项、签名更新与 Widget 注册的验收边界见 [二期清单](docs/phase-two.md) 和 [验证记录](docs/verification.md)。UI 先保持功能可用，视觉后续统一调整。旧原型已归档并移除，没有恢复旧引擎。

## 下载

在 [Releases](https://github.com/cixiangtao/codex-coco/releases/tag/v0.1.0-preview.1) 下载 macOS arm64 的 DMG 或 ZIP，核对 SHA256SUMS.txt 后，将 Codex Coco.app 移到 Applications。若提示“Apple 无法验证 Codex Coco”，先关闭提示，再到 **系统设置 → 隐私与安全性 → 仍要打开**，最后确认 **打开**。长期自签名不能消除这个首次打开提示。详见 [安装指南](apps/desktop/resources/INSTALL.txt) 和 [Apple 官方说明](https://support.apple.com/102445)，无需安装根证书或关闭全局 Gatekeeper。

本预览版不进入正式更新频道，预览更新需手动下载。免费长期自签名身份、验证范围与日常发行流程见 [发行说明](docs/releases.md)。

## 当前能力

| 入口     | 核心能力                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 用量     | 脱敏账号与套餐、CLI App Server 额度窗口、恢复时间、手动与 opt-in 后台刷新、失败退避、额度/恢复/重置卡到期通知 |
| 本地统计 | 今日/近 7 天/近 30 天摘要、增量索引、去重、7/14/30 天趋势、只读 SQLite 估算回退、账号范围与无归属标记         |
| 用量工具 | 重置卡显式兑换与幂等恢复、模型目录与推理强度、结构化样本、取消、摘要历史、CLI 检测与升级                      |
| 外观     | 壁纸/主面板/侧栏三层、自定义图片、许可图库、12 组预设、组合预览、拖动和键盘定位、独立保存与应用               |
| 外观连接 | 固定/自动本机端口、应用选择、显式启动和重启、多窗口与重载重应用、opt-in 启动恢复、实际样式验证与撤销          |
| 菜单栏   | 跨模块只读速览、额度窗口与标签选择、原生及自定义图标、19 个 GIF、逐图速度、按需 CPU 联动                      |
| 设置     | 浅色/深色/系统主题、自定义主色、安装版登录项确认、公开共享快照、更新偏好与配置恢复                            |
| 原生扩展 | WidgetKit 源码与共享合同；已类型检查，仍需 Team、签名与 App Group 注册                                        |
| 应用更新 | GitHub Releases 检查与发布页下载，签名版支持确认下载、校验和安装；未签名包可检测、不可自替换                  |

用量行为对照和明确缺口见 [用量对照记录](docs/usage-parity.md)。详细边界：[用量](docs/usage.md) · [外观](docs/appearance.md) · [菜单栏](docs/menu-bar.md) · [应用更新](docs/updates.md)。模型样本用于固定题对比，不代表模型整体能力评价。

## 参与和反馈

问题与建议请提交到 [GitHub Issues](https://github.com/cixiangtao/codex-coco/issues)。开发约定见 [贡献指南](CONTRIBUTING.md)，安全问题请使用 [私密报告渠道](SECURITY.md)。英文 README 是主要入口，本文维护中文功能、开发和数据说明。

## 开发

使用 Node.js 24、pnpm 12.14.0。首次安装需要下载 Electron 的平台二进制。

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

构建和运行生产文件：

```sh
pnpm run build
pnpm run start
```

基础检查和完整本地包回归：

```sh
pnpm run check
pnpm run verify:packaged
```

`check` 执行 Oxfmt、Oxlint、Oxc AST 依赖边界、分进程类型检查、合同测试和生产构建。`verify:packaged` 重新生成 macOS arm64 未签名应用，并依次执行主窗口、速览、worker、用量、外观、刷新策略、本地趋势、重置卡、模型与 CLI 工具、系统偏好和更新回归。全部使用临时数据与受控服务。

常用独立验收命令：

```sh
pnpm run verify:desktop
pnpm run verify:modules
pnpm run verify:diagnostics
pnpm run verify:appearance
pnpm run verify:appearance-launcher
pnpm run verify:desktop-preferences
pnpm run verify:updates
pnpm run verify:widget
```

`verify:appearance-launcher` 和 `verify:widget` 需要本机已有 Swift 编译器和 macOS SDK，不自动安装工具链。前者启动临时目标；后者仅类型检查原生扩展。其他用量专项脚本见 package.json。

`pnpm run pack` 只生成本机应用目录，不发布；始终保留 `run`，避免调用 pnpm 内置的 npm 打包命令。独立格式化、检查、测试命令分别为 `format`、`format:check`、`lint`、`typecheck`、`test`。

## 工程边界

```text
apps/desktop/src/
  desktop/       Electron 适配、preload、协议、原生窗口与系统入口
  application/   模块生命周期、配置、诊断、共享存储与应用更新状态
  contracts/     纯数据合同、校验及白名单桌面桥
  renderer/      主窗口、设置客户端与窗口内草稿
  modules/       usage、appearance、desktop-tools 和显式验收模块
packages/ui/src/
  components/    Tailwind + shadcn 自定义基础组件
  theme/         主题合同、解析器与受控 Provider
  styles/        语义变量与 Tailwind 映射
native/widget/   WidgetKit 源码与接入说明
```

后台与页面分别静态注册。每个业务模块有独立版本化配置与写入队列，固定操作名、输入和公开结果均经校验；每个模块同时执行一个操作。取消、停用和退出等待资源实际释放，清理失败不伪称成功。默认三个业务模块均停用，不加载示例；未打包验收可显式使用 `CODEX_COCO_FIXTURES=1`，打包应用忽略该开关。

重计算按任务创建 worker，不失败回退到主线程。UI 包不依赖 Electron、Node、IPC、业务后台或存储。Oxc AST 检查实际导入目标，阻止跨进程、跨模块和 UI 到宿主的非法依赖。详见 [模块开发](docs/module-development.md)、[工作线程](docs/worker-tasks.md) 与 [UI 和主题](docs/ui-package-and-theme.md)。

## 使用和数据

用量需要本机可运行的 Codex CLI 和 ChatGPT 登录。模块默认停用；启用或重启恢复启用状态时自动读取一次，新窗口共享状态。定时刷新单独控制，间隔 0 不轮询。重启可先恢复上次成功的脱敏额度，明确标注时间与历史状态，失败时折叠旧记录。成功刷新额度时会在 worker 更新本地计数，也可明确扫描或开启 opt-in 回退策略。Codex Coco 不直接读取登录令牌，不自动创建模型对话。样本推理、重置卡消费和 CLI 升级各自明确确认。

主窗口承载完整模块能力，固定图标侧栏支持 hover 与键盘提示。点击菜单栏 Codex Coco 或按 Cmd+Shift+M 打开速览，失焦/Esc 收起。速览只收到白名单公开投影，不收到完整结果、配置、凭据、路径或模型回答，也不能执行写操作。失败时隐藏旧额度，恢复操作优先。

外观图片复制到独立内容寻址目录，不改原文件。保存配置、预设和预览不等于应用；明确应用后才修改目标样式。保存的自动恢复策略只在下次启用时恢复连接，不自动启动或重启 Codex。停用/退出撤销自己的样式，不停止其他主题工具、不改安装包。

默认配置位于 `~/Library/Application Support/Codex Coco/foundation/`；开发与验证可用 `CODEX_COCO_DATA_DIR` 隔离。设置和旧应用数据不混用，不读取两个旧仓库的配置。诊断只保存固定事件、耗时、错误码和关联 ID，排除原始异常、配置、账号、模型回答与私有路径。没有遥测或云同步。

应用更新固定使用本仓库 GitHub Releases，默认手动检查；后台检查只查版本，不自动下载或安装。源码仓库位于 [GitHub](https://github.com/cixiangtao/codex-coco)，当前已有自签名 Pre-release，尚无正式稳定版。Widget 共享默认关闭，实际原生扩展注册步骤见 [native/widget](native/widget/README.md)。

## 验证和后续

当前优先验证 macOS arm64，本地包仍使用 Electron 默认图标。受控 Electron 页面、CLI 与更新引擎验证不能替代真实账号、真实目标版本、签名安装或系统扩展验收。完整记录在 [验证记录](docs/verification.md)，待真实环境确认的条目在 [二期清单](docs/phase-two.md)。

`profile:desktop` / `profile:packaged` 使用临时数据测启动及所有 Electron 进程的 CPU、工作集。功能增加后没有重新建立性能基线，不宣称本轮性能达标。参见 [测量口径](docs/diagnostics-and-performance.md)。历史界面对照可用 `design:review` 查看，包含合成数据，正式应用不加载该入口。

[产品约定](PRODUCT.md) · [架构](docs/architecture.md) · [界面基线](DESIGN.md) · [来源与许可证](THIRD_PARTY_NOTICES.md)

MIT。Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。
