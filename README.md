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
pnpm run pack
pnpm run verify:packaged
```

- `check`：Oxfmt、Oxlint、依赖边界、分进程类型、合同测试与生产构建。
- `verify:desktop`：构建后启动真实 Electron，用临时配置验证主题、IPC、窗口同步、取消和重启恢复，结束后清理进程与数据。
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
  modules/       后续业务模块注册入口，目前为空
packages/ui/src/
  components/    shadcn 自有组件源码
  theme/         纯主题合同、解析器与受控 Provider
  styles/        共享语义变量和 Tailwind 映射
  lib/           界面工具
```

Oxfmt 管格式，Oxlint 检查代码问题。基于 Oxc AST 的依赖检查阻止跨进程、跨模块和 UI 包到宿主的非法导入；TypeScript 对 Node、preload、合同、renderer、UI 包和测试分别检查。

## 当前主题能力

浅色、深色、跟随系统；中性、蓝色和紫色工程预设；支持 HEX 自定义主色，自动生成文字、悬停/按下、选中和焦点变量。预设用于验证机制，正式视觉仍待评审。

未保存修改只在当前窗口预览。保存后原子写入并通知其他窗口，过期 revision 会被拒绝；取消恢复最新保存状态。损坏或未来版本的配置保留原件，显式恢复时先备份。Dialog 继承文档根主题，支持键盘关闭和焦点返回。

UI 包不依赖 Electron、Node、IPC 或存储。应用负责偏好持久化、恢复和窗口同步。Codex Coco 自身主题与未来外部 Codex 布景业务分别管理。

## 数据与交付

默认配置位于 `~/Library/Application Support/Codex Coco/foundation/`，与已归档原型的数据隔离。开发与验证可用 `CODEX_COCO_DATA_DIR` 指向其他目录。当前没有账号读取、用量请求、外观注入、遥测或云同步，不读取旧应用配置。

目前先验证 macOS arm64。应用目录仍使用 Electron 默认图标，跳过签名，未公证，也没有更新或公开发布。两个旧仓库和已有应用数据保持原样；仓库只在本地维护，未配置远端。

[产品约定](PRODUCT.md) · [基建方案](docs/foundation-plan.md) · [当前架构](docs/architecture.md) · [UI 与主题](docs/ui-package-and-theme.md) · [验证记录](docs/verification.md) · [功能重建计划](docs/migration.md) · [原型清理记录](docs/prototype-reset.md) · [来源与许可证](THIRD_PARTY_NOTICES.md)

MIT。Codex Coco 是独立项目，与 OpenAI 没有隶属或官方支持关系。
