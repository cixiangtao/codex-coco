# Codex Coco

称呼用户为 IKUN同学，思考和回复使用中文。

## 当前阶段

2026-10-21：用户授权移除原型，从零建立新基建。原型源码、测试、依赖、构建配置、设计记录与生成物已从工作树清理，清理前做了仓库外可恢复归档。不要恢复原型或添加兼容层作为默认起点。

已从零建立可运行的 Electron、React、TypeScript 工程，独立 UI 包与主题基础、版本化配置、模块生命周期和白名单桌面桥已接入。当前页面只是基建验证工作台，业务注册表为空；暂停用量与外观功能，正式视觉方向须经用户确认。实际状态与未完成目标见 docs/verification.md。

## 长期约定

- 软件名称始终使用完整的 **Codex Coco**，不使用简称；仓库与机器标识使用 `codex-coco`。
- 这是独立项目，贴合维护者习惯、学习与持续打磨优先，不以追赶明星仓库的功能数量为目标。
- 只维护本地仓库，不自动创建远端、推送、发布或修改旧仓库。
- 每次功能新增、改造或修复完成并通过相应检查后，自动创建本地 Git 提交，无需再次询问。提交前审查完整差异，按独立意图拆分，只纳入本次相关改动；检查未通过或工作未完成时不作为已完成变更提交。最终回复说明提交编号与验证结果。用户明确要求只分析或暂不提交时遵循当次指令。
- 文档中文为主，主要 README 提供英文说明；界面先使用中文。
- Electron 是普通用户入口，TypeScript 实现业务，React 实现界面，先验证 macOS。
- 使用 Node.js 24、pnpm 12.14.0；保持 packageManager 和 pnpm-lock.yaml 一致，只保留 pnpm 锁文件。不修改用户全局包管理器配置。
- 格式化使用 Oxc 的 Oxfmt，代码检查使用 Oxlint，进程/包依赖边界由 Oxc parser AST 脚本检查；类型检查仍由 TypeScript 独立负责。
- 桌面应用位于 `apps/desktop`；私有 UI 包 `@codex-coco/ui` 位于 `packages/ui`，应用通过 `workspace:*` 依赖。
- UI 使用 Tailwind CSS + shadcn/ui 构建自有组件。基础控件、语义 token、业务复合组件与窗口布局分层；不安装或延续 Ant Design。
- cn 类名工具统一通过 `import { cn } from "cn"` 直接使用 npm 包，不建立本地封装或重导出入口；shadcn 的 aliases.utils 指向 cn。
- UI 包不依赖 Electron、Node.js、IPC、应用配置服务或业务模块。业务复合组件留在应用，复用通过公开导出进行。
- UI 包提供主题类型、解析和受控 Provider；支持浅色/深色/跟随系统、预设及自定义主色。应用负责偏好持久化、迁移、启动恢复与多窗口同步。弹层继承同一主题。
- Codex Coco 自身 UI 主题与外部 Codex 布景业务分离；主题细节见 `docs/ui-package-and-theme.md`。
- `apps/desktop/src/modules/<id>/` 按模块组织合同、运行时与页面，独立启停，不直接调用其他模块后台。
- `application/` 管理生命周期与配置，`desktop/` 提供 Electron 适配；`contracts/` 只放纯数据合同，不导入宿主或业务后台。
- 凭据只在后台读取，不通过 IPC、日志、截图或错误堆栈返回界面。
- 外观默认关闭；不自动重启 Codex，不停止其他主题工具，不读写旧项目数据目录。
- 重新引用旧项目代码或资产时同步来源、许可证与差异记录，不自动搬回旧引擎。原型测试结果不作为新实现验收。
- 不把包骨架描述为基建完成，不把开发预览描述成完整迁移，不把本地构建描述成签名、公证或发布。

## 当前验证

- pnpm run check：Oxfmt、Oxlint、AST 依赖边界、分进程/包/测试类型检查、合同测试和生产构建。
- pnpm run verify:desktop：生产入口的真实 Electron 回归，使用临时数据，结束后清理。
- pnpm run pack：本机未签名的 macOS 应用目录；必须写 run，避免调用 pnpm 内置 pack。
- pnpm run verify:packaged：生成并验证 macOS arm64 本地应用本身。

默认配置位于 Codex Coco/foundation，不复用原型目录。CODEX_COCO_DATA_DIR 用于隔离开发和验证。新增依赖锁精确版本，pnpm 12 的构建脚本策略使用 allowBuilds，不使用已移除的 onlyBuiltDependencies。

改变生命周期、数据解析或 IPC 时，增加针对合同的测试；界面实现后通过真实 Electron 验证。修改后执行对应检查；干净安装和构建在工具链变更时验证，不因纯文档修改重复整套桌面回归。

UI 验证页、base-nova 和工程预设不是已认可的视觉方案。独立局部主题作用域、业务操作分发、模块专属配置迁移、worker 服务和有界诊断日志仍是后续基建目标；不要把本轮基线描述为 F01–F15 全部完成。
