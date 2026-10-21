# Codex Coco

一个按自己习惯打磨的 Codex 桌面伴侣。

[English](README.en.md)

Codex Coco 计划将用量监控与外观定制放进一个 Electron 应用，并为后续模块保留独立生命周期和配置边界。个人使用习惯、学习与持续打磨是项目的出发点。

**当前状态：可运行的本地基建验证版。** 已从零搭建 Electron、React、TypeScript、独立 UI 包、主题基础与工程检查。用量和外观业务尚未接入，当前验证页不代表正式产品布局或已认可的视觉方向。旧原型已归档并移除，没有恢复其实现。

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
pnpm run verify:diagnostics
pnpm run pack
pnpm run verify:packaged
```

- `check`：Oxfmt、Oxlint、依赖边界、分进程类型、合同测试与生产构建。
- `verify:desktop`：构建后启动真实 Electron，用临时配置验证主题、IPC、窗口同步、取消和重启恢复，结束后清理进程与数据。
- `verify:modules`：构建后用两个合成模块验证任务、取消、独立配置、跨窗口、重启与损坏恢复，全程使用临时目录并自动清理。
- `pack`：生成本机未签名的 macOS 应用目录；不是 npm 打包，不执行发布。
- `verify:packaged`：重新生成本地应用目录，并对其中的应用执行同一套桌面回归。此脚本目前针对 macOS arm64。

单独执行：`pnpm run format`、`pnpm run format:check`、`pnpm run lint`、`pnpm run typecheck`、`pnpm run test`。始终写明 `pnpm run pack`，避免调用 pnpm 内置的 npm 包打包命令。

## 工程边界

```text
apps/desktop/src/
  desktop/       Electron 主进程、preload、协议和系统入口
  application/   模块生命周期与版本化配置
  contracts/     纯数据类型、运行时校验与白名单桌面桥合同
  renderer/      React 验证页、设置客户端和预览草稿
  modules/       业务注册表为空；含显式开启的合成验收模块
packages/ui/src/
  components/    shadcn 自有组件源码
  theme/         纯主题合同、解析器与受控 Provider
  styles/        共享语义变量和 Tailwind 映射
```

Oxfmt 管格式，Oxlint 检查代码问题。基于 Oxc AST 的依赖检查阻止跨进程、跨模块和 UI 包到宿主的非法导入；TypeScript 对 Node、preload、合同、renderer、UI 包和测试分别检查。

## 模块接入基础

后台与页面分别静态注册，固定操作名与输入、公开结果均由模块声明校验。每个模块有独立的版本化配置和写入队列；保存冲突、迁移备份与损坏恢复不影响其他模块。每个模块同时运行一个操作，取消须等待任务实际结束；超时未释放资源时保留错误，不伪装成停用成功。

普通启动不注册示例。`verify:modules` 显式开启未打包环境的 `CODEX_COCO_FIXTURES=1`，运行合成示例；打包应用忽略该开关。配置只保存可公开偏好，配置变更供下一次操作使用。接入方式见 [模块开发](docs/module-development.md)。

## 当前主题能力

浅色、深色、跟随系统；中性、蓝色和紫色工程预设；支持 HEX 自定义主色，自动生成文字、悬停/按下、选中和焦点变量。预设用于验证机制，正式视觉仍待评审。

未保存修改只在当前窗口预览。保存后原子写入并通知其他窗口，过期 revision 会被拒绝；取消恢复最新保存状态。损坏或未来版本的配置保留原件，显式恢复时先备份。Dialog 继承文档根主题，支持键盘关闭和焦点返回。

UI 包不依赖 Electron、Node、IPC 或存储。应用负责偏好持久化、恢复和窗口同步。Codex Coco 自身主题与未来外部 Codex 布景业务分别管理。

## 诊断与性能

本地结构化日志记录固定事件、耗时、错误码和关联 ID，不保存配置内容、原始异常或账号信息。默认最多三个 256 KiB 文件，内存队列最多 256 条/128 KiB，写入失败不阻塞应用；verify:diagnostics 验证真实桌面行为。

`pnpm run profile:desktop` 测生产文件，`pnpm run profile:packaged` 测重新生成的 macOS 应用。两者使用独立临时数据，记录窗口启动及 Browser/Tab/GPU/Utility 等进程的 CPU、工作集；应用不常驻采样。结果用于本机比较，不代表跨设备性能达标。详见 [诊断与测量口径](docs/diagnostics-and-performance.md) 和 [性能基线](docs/performance-baseline.md)。

## 数据与交付

默认配置位于 `~/Library/Application Support/Codex Coco/foundation/`，与已归档原型的数据隔离。开发与验证可用 `CODEX_COCO_DATA_DIR` 指向其他目录。当前没有账号读取、用量请求、外观注入、遥测或云同步，不读取旧应用配置。

目前先验证 macOS arm64。应用目录仍使用 Electron 默认图标，跳过签名，未公证，也没有更新或公开发布。两个旧仓库和已有应用数据保持原样；仓库只在本地维护，未配置远端。

[产品约定](PRODUCT.md) · [基建方案](docs/foundation-plan.md) · [当前架构](docs/architecture.md) · [UI 与主题](docs/ui-package-and-theme.md) · [验证记录](docs/verification.md) · [功能重建计划](docs/migration.md) · [原型清理记录](docs/prototype-reset.md) · [来源与许可证](THIRD_PARTY_NOTICES.md)

MIT。Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。

## 窗口方案评审

执行 `pnpm run design:review`，打开本机 <http://127.0.0.1:5190/>，比较固定侧栏、顶部导航和工具台分栏三个完整窗口方案，以及跨模块菜单栏悬浮窗。可切换明暗主题、主色与用量异常状态。全部使用合成数据与页内交互，正常 Electron 入口仍是基建验证页。`pnpm run design:build` 单独检查评审页构建。方案尚未定稿，详见 [窗口方案评审](docs/design-review.md)。
