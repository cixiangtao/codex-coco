# Codex Coco

一个按自己习惯打磨的 Codex 桌面伴侣。

[English](README.en.md)

Codex Coco 计划将用量监控与外观定制放进一个 Electron 应用，并为后续模块保留独立生命周期和配置边界。个人使用习惯、学习与持续打磨是项目的出发点。

**当前状态：已接入用量手动读取的本地开发版。** 主窗口采用固定图标侧栏，支持四页导航、菜单提示及真实主题设置。用量模块通过本机 Codex CLI 读取 ChatGPT 订阅额度，主窗口和菜单栏共享快照；默认停用，明确操作后才读取。外观业务尚未接入。旧原型已归档并移除，没有恢复其实现。

## 开发

使用 Node.js 24、pnpm 12.14.0。需要下载 Electron 的平台二进制，首次安装可能较慢。

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

构建和运行生产文件：

```sh
pnpm run build
pnpm run start
```

检查与本地打包：

```sh
pnpm run check
pnpm run verify:desktop
pnpm run verify:modules
pnpm run verify:workers
pnpm run verify:usage
pnpm run verify:menu-bar
pnpm run verify:diagnostics
pnpm run pack
pnpm run verify:packaged
```

- `check`：Oxfmt、Oxlint、依赖边界、分进程类型、合同测试与生产构建。
- `verify:desktop`：构建后启动真实 Electron，用临时配置验证主题、IPC、窗口同步、取消和重启恢复，结束后清理进程与数据。
- `verify:menu-bar`：验证菜单栏开合回调、窗口权限、状态/主题同步、主窗口重开与读取失败恢复，全程使用临时数据。
- `verify:modules`：构建后用两个合成模块验证任务、取消、独立配置、跨窗口、重启与损坏恢复，全程使用临时目录并自动清理。
- `verify:workers`：验证真实 Electron 中独立线程构建入口的加载、进度、结果和实际退出，使用临时数据。
- `verify:usage`：通过临时受控 stdio 服务验证启用、读取、失败恢复、取消、跨窗口与只读摘要，不读取真实账号。
- `pack`：生成本机未签名的 macOS 应用目录；不是 npm 打包，不执行发布。
- `verify:packaged`：重新生成本地应用目录，并对其中的应用执行主窗口、速览、线程资源与用量流程回归。此脚本目前针对 macOS arm64。

单独执行：`pnpm run format`、`pnpm run format:check`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`。始终写明 `pnpm run pack`，避免调用 pnpm 内置的 npm 包打包命令。

## 工程边界

```text
apps/desktop/src/
  desktop/       Electron 主进程、preload、协议和系统入口
  application/   模块生命周期与版本化配置
  contracts/     纯数据类型、运行时校验与白名单桌面桥合同
  renderer/      主窗口布局、页面、设置客户端和预览草稿
  modules/       用量模块与显式开启的合成验收模块
packages/ui/src/
  components/    shadcn 自有组件源码
  theme/         纯主题合同、解析器与受控 Provider
  styles/        共享语义变量和 Tailwind 映射
```

Oxfmt 管格式，Oxlint 检查代码问题。基于 Oxc AST 的依赖检查阻止跨进程、跨模块和 UI 包到宿主的非法导入；TypeScript 对 Node、preload、合同、renderer、UI 包和测试分别检查。

## 模块接入基础

后台与页面分别静态注册，固定操作名与输入、公开结果均由模块声明校验。每个模块有独立的版本化配置和写入队列；保存冲突、迁移备份与损坏恢复不影响其他模块。每个模块同时运行一个操作，取消须等待任务实际结束；超时未释放资源时保留错误，不伪装成停用成功。

普通启动注册默认停用的用量模块，不注册示例。`verify:modules` 显式开启未打包环境的 `CODEX_COCO_FIXTURES=1`，额外运行合成示例；打包应用忽略该开关。配置只保存可公开偏好，配置变更供下一次操作使用。接入方式见 [模块开发](docs/module-development.md)。

重计算通过按任务创建的工作线程执行，取消、超时、停用及退出等待真实线程释放，不回退到主线程。合成模块已使用该路径；固定消息经过 JSON、大小与结构校验，业务结果仍由模块合同再次校验。详见 [工作线程](docs/worker-tasks.md)。

## 菜单栏速览

点击菜单栏中的 Codex Coco 开合悬浮窗，或使用应用菜单“显示或收起速览”（Cmd+Shift+M）。速览提供跨模块状态，失焦或按 Esc 收起，可跳转到主窗口的对应页面；关闭全部主窗口后，仍能从菜单栏重新打开。它跟随已保存主题，主窗口尚未保存的预览不会同步进去。

启用并手动读取后，速览展示用量窗口、剩余比例、恢复时间与读取时间。读取失败时隐藏旧额度，提供主窗口恢复入口；外观仍明确显示尚未接入。新增注册模块会加入状态摘要，完整操作仍在主窗口。速览的刷新按钮只读取摘要，不发起账号请求。详见 [菜单栏与权限边界](docs/menu-bar.md)。

## 用量读取

本机需要可运行的 Codex CLI，并使用 ChatGPT 账号登录。打开“用量 → 启用并读取用量”获取记录；后续手动刷新，也可取消。模块管理可以停用。恢复启用状态、重启和新开窗口不会自动读取账号。

通过官方 App Server 的只读用量协议读取，Codex Coco 不直接读取或保存登录令牌，不创建对话。失败时先显示恢复路径，上次成功记录默认折叠；未知数据不会显示为零。当前没有自动刷新、趋势、多账号或通知。详见 [数据来源、权限与验证边界](docs/usage.md)。

## 当前主题能力

浅色、深色、跟随系统；中性、蓝色和紫色工程预设；支持 HEX 自定义主色，自动生成文字、悬停/按下、选中和焦点变量。预设属于工程配色；主窗口布局基线见 [界面基线](DESIGN.md)。

切换页面保留未保存输入，未保存修改只在当前窗口预览。保存后原子写入并通知其他窗口，过期 revision 会被拒绝；取消恢复最新保存状态。损坏或未来版本的配置保留原件，显式恢复时先备份。Dialog 继承文档根主题，支持键盘关闭和焦点返回。

UI 包不依赖 Electron、Node、IPC 或存储。应用负责偏好持久化、恢复和窗口同步。Codex Coco 自身主题与未来外部 Codex 布景业务分别管理。

## 诊断与性能

本地结构化日志记录固定事件、耗时、错误码和关联 ID，不保存配置内容、原始异常或账号信息。默认最多三个 256 KiB 文件，内存队列最多 256 条/128 KiB，写入失败不阻塞应用；verify:diagnostics 验证真实桌面行为。

`pnpm run profile:desktop` 测生产文件，`pnpm run profile:packaged` 测重新生成的 macOS 应用。两者使用独立临时数据，记录窗口启动及 Browser/Tab/GPU/Utility 等进程的 CPU、工作集；应用不常驻采样。结果用于本机比较，不代表跨设备性能达标。详见 [诊断与测量口径](docs/diagnostics-and-performance.md) 和 [性能基线](docs/performance-baseline.md)。

## 数据与交付

默认配置位于 `~/Library/Application Support/Codex Coco/foundation/`，与已归档原型的数据隔离。开发与验证可用 `CODEX_COCO_DATA_DIR` 指向其他目录。用量只在手动操作后通过 CLI 读取，公开结果不包含邮箱或令牌；当前没有外观注入、遥测或云同步，不读取旧应用配置。

目前先验证 macOS arm64。应用目录仍使用 Electron 默认图标，跳过签名，未公证，也没有更新或公开发布。两个旧仓库和已有应用数据保持原样；仓库只在本地维护，未配置远端。

[产品约定](PRODUCT.md) · [基建方案](docs/foundation-plan.md) · [当前架构](docs/architecture.md) · [正式主窗口](docs/main-window.md) · [菜单栏速览](docs/menu-bar.md) · [UI 与主题](docs/ui-package-and-theme.md) · [验证记录](docs/verification.md) · [功能重建计划](docs/migration.md) · [原型清理记录](docs/prototype-reset.md) · [来源与许可证](THIRD_PARTY_NOTICES.md)

MIT。Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。

## 窗口方案评审

执行 `pnpm run design:review`，打开本机 <http://127.0.0.1:5190/>，默认查看精简侧栏方案，也可比较顶部导航和工具台分栏，以及跨模块菜单栏悬浮窗。精简侧栏支持折叠，常用模块在上、模块管理和设置在下；可切换明暗主题、主色与用量异常状态。全部使用合成数据与页内交互，正常 Electron 入口已使用独立实现的精简侧栏和真实设置，不加载这些示意数据。`pnpm run design:build` 单独检查评审页构建。方案尚未定稿，详见 [窗口方案评审](docs/design-review.md)。
