# Codex Coco

称呼用户为 IKUN同学，思考和回复使用中文。

## 当前阶段

2026-10-21：用户授权移除原型，从零建立新基建。原型源码、测试、依赖、构建配置、设计记录与生成物已从工作树清理，清理前做了仓库外可恢复归档。不要恢复原型或添加兼容层作为默认起点。

已从零建立可运行的 Electron、React、TypeScript 工程，独立 UI 包与主题基础、版本化配置、模块生命周期和白名单桌面桥已接入。正式主窗口使用固定图标侧栏和真实主题设置；用量模块已接入默认停用的 CLI App Server 启用后读取，主窗口与菜单栏共享公开额度。外观已接入三层布景、自定义图片与显式可撤销的本机 CDP 应用；完整二期目标见 docs/phase-two.md。实际状态与未完成目标见 docs/verification.md。

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
- pnpm run verify:diagnostics：真实 Electron 验证日志关联、隐私字段排除与写入失败隔离。
- pnpm run profile:desktop / profile:packaged：显式采样生产文件/打包应用的启动和全进程资源，使用临时数据，不作为性能达标声明。
- pnpm run verify:menu-bar：验证真实菜单栏回调、只读窗口权限、速览状态/主题同步、开合和主窗口重开。
- pnpm run verify:modules：生产入口的真实模块链路回归，仅注册合成模块并使用临时数据，结束后清理。
- pnpm run verify:workers：验证真实 Electron 中独立 worker 构建入口、进度、结果与实际退出；打包回归包含同一资源验证。
- pnpm run verify:usage：临时 PATH 中的受控 stdio 服务验证读取、失败恢复、取消、重启与只读摘要；不得使用真实账号代替测试数据。
- pnpm run verify:ui：受控 CLI 与临时数据验证圆环数值、720px 布局、标签页草稿、只读速览、明暗/自定义主色与减少动态效果；支持脚本 --packaged 验证本地包。
- pnpm run verify:desktop：生产入口的真实 Electron 回归，使用临时数据，结束后清理。
- pnpm run pack：本机未签名的 macOS 应用目录；必须写 run，避免调用 pnpm 内置 pack。
- pnpm run verify:packaged：生成并验证 macOS arm64 本地应用本身。

默认配置位于 Codex Coco/foundation，不复用原型目录。CODEX_COCO_DATA_DIR 用于隔离开发和验证。新增依赖锁精确版本，pnpm 12 的构建脚本策略使用 allowBuilds，不使用已移除的 onlyBuiltDependencies。

改变生命周期、数据解析或 IPC 时，增加针对合同的测试；界面实现后通过真实 Electron 验证。修改后执行对应检查；干净安装和构建在工具链变更时验证，不因纯文档修改重复整套桌面回归。

正式主窗口采用已认可的固定图标侧栏与菜单提示，布局基线见 DESIGN.md；base-nova 和工程配色预设不代表最终品牌视觉。按任务工作线程、本地有界诊断与可复现性能采样已接入；独立局部主题作用域仍是后续基建目标；不要把本轮基线描述为 F01–F15 全部完成。

2026-10-22 用户认可 A 柔彩仪表台，要求圆润、紧凑并先组件化。Card 统一表面、18px 圆角与 default/compact 内距，Box 只处理排列与间距；Badge、Tabs、ProgressRing、Skeleton 放在 UI 包。额度与账号等业务组合留在模块 renderer。用量页分总览/辅助工具/用量设置，速览使用同一圆环和紧凑模块行；外观页分布景编辑/图片与预设/连接设置，复用同一容器、状态与标签页，三层几何与保存应用边界保持独立。不把样稿示例数据或色板写入正式页面。设置等页面尚未全部迁移该视觉。

模块接入使用 application/module-host.ts 的 BuiltinModule 合同。后台在 modules/registry.ts 注册，页面在 renderer/module-pages.ts 注册；模块自己的纯 contract.ts 与 renderer/ 分别接受合同和浏览器边界检查。配置仅包含可公开的偏好，不保存凭据或私有数据；配置变化供下一次操作使用。CODEX_COCO_FIXTURES=1 仅允许未打包验证环境额外加载合成模块，打包应用始终禁用示例。业务注册表目前包含默认停用的用量、外观、系统与菜单栏三个模块。

诊断只经 DiagnosticSink 写入固定字段；禁止传入原始异常、请求、配置、结果、路径或账号内容。新增事件与错误码需同步允许列表。默认最多三个 256 KiB 文件，内存队列同时受条数和字节限制；日志失败不阻塞业务。性能采样只由显式脚本触发，不增加常驻轮询；口径与基线见 docs/diagnostics-and-performance.md 和 docs/performance-baseline.md。

窗口交互提案独立放在 renderer/design-review，通过 pnpm run design:review 查看，不接入正常 Electron 入口或真实业务。用户认可侧栏布局方向并要求参考 Codex 客户端精简导航，目前默认 A 精简侧栏并保留 B/C 对照；正式 Electron 已独立实现 A 的布局，视觉细节仍可打磨。主窗口承载完整模块能力，菜单栏悬浮窗跨模块速览。异常时优先展示恢复路径，旧数据默认收起。详见 docs/design-review.md。

菜单栏速览通过主进程注册的窗口身份限制为只读，仅接收 application/glance.ts 的公开状态投影，不接收完整模块事件、配置或结果。跳转只接受固定 MainPage；新摘要数据或业务刷新接入时同步合同、权限与隐私测试。原生生命周期与边界见 docs/menu-bar.md。

重计算通过 application/worker-task.ts 执行。Worker 工厂由组合根静态注入，不接受 renderer 或配置传入的代码路径；禁止失败后回退主线程。取消、停用与退出须等待实际线程退出，终止失败不得伪装清理成功。worker 返回严格 JSON 消息，公开输出仍须模块自己的 schema 校验。构建入口与打包资源一同验证，详见 docs/worker-tasks.md。

用量仅在模块已启用时启动短期 codex app-server：启用或应用重启时自动读取一次，也可手动读取或保存定时策略，固定调用 initialize/initialized、account/read(refreshToken:false) 与 account/rateLimits/read；不读取原始令牌，不启动模型对话或登录。2026-10-22 用户授权将启动读取与定时刷新分开；间隔 0 不定时轮询，已启用模块仍在启用或重启时读取一次，新窗口共享状态。成功额度按来源隔离保存到私有缓存，恢复时明确为历史记录；失败时旧数据折叠，菜单栏不将缓存当作当前额度。主窗口可单独保存 30–3600 秒定时间隔。stdout 在后台限量解析，stderr 丢弃，子进程退出后才结算。BuiltinModule.glance 的公开字段须宿主严格校验；失败时摘要不携带旧额度。详见 docs/usage.md。

二期从 2026-10-21 起要求覆盖两个旧项目的全部能力，按 docs/phase-two.md 逐项推进。用户允许先实现核心功能，UI 后期调整，不再以“只迁核心”缩小二期目标。外观支持固定或自动本机 CDP 端口、私有应用选择、显式启动/重启、图库预设与 opt-in 恢复。真实聊天客户端未操作；默认手动应用，保存与应用分离，停用和退出清理自己的样式，不接管旧服务。

用量配置版本 2 将旧空配置迁移为不定时刷新、通知关闭。自动刷新通过宿主 requestOperation 执行，失败退避、单模块任务约束和停止清理保持有效。系统通知由桌面依赖注入，只接收固定标题和公开额度文案。菜单栏 statusText 为严格限长公开字段，不接收配置或原始账号；完整名称 Codex Coco 始终保留。配置保存通知 runtime.configurationChanged，观察者失败不能把已成功持久化的操作伪报为失败。

用量配置当前 v3 增加 localFallbackEnabled（默认 false）与 trendDays（7/14/30）。本机扫描由成功额度刷新、主窗口明确请求或已保存的本地回退策略触发，在 usage-worker 中执行；独立静态构建入口必须随打包验证。source.json 中的目录属于私有服务状态，不进入公共模块配置。公开趋势只有按日数值、来源、范围和完整性；JSONL 与 SQLite 估算不可混加；无归属记录不得冒充当前账号统计。

重置卡已通过官方 account/rateLimits/read 与 account/rateLimitResetCredit/consume 接入。消费只允许主窗口明确确认，后台先重新核对账号与引用，发送前持久化 pending 幂等请求；重试必须复用 UUID，未确认请求不能被新请求覆盖。usage-reset-attempts.json 是私有业务状态，允许保存卡 ID 与匿名账号关联，权限 0600，禁止存储令牌。取消/重启后通过检查上次兑换恢复，不代用户消费真实卡。

用量辅助工具已接入模型目录、结构化样本、摘要历史与 CLI 维护。真实模型调用和 CLI 更新仅由主窗口明确确认；自动额度刷新不能触发。样本固定问题通过临时目录、ephemeral、ignore-user-config、ignore-rules、project_doc_max_bytes=0 和禁用工具执行，取消等待所属进程组实际退出。测试必须用受控 CLI，不代用户跑真实推理或更新真实 CLI。模型回答只用于主窗口临时结果，历史/诊断/菜单栏不能复制回答文本。模块 renderer 的 Tailwind 源使用完整文件 glob，保留真实尺寸验收，防止类名未生成却截图误判。

系统与菜单栏模块使用独立配置，GIF 通过 tray-worker 解码。动画或 CPU 联动只在启用时运行，停止清理所有计时器。开机启动限安装版且必须单独确认，保存图标偏好不修改 OS 登录项；停用不撤销 OS 登录项。共享快照只接受 GlanceSnapshot 公共投影，默认关闭。WidgetKit 源码类型检查不代表扩展已签名或注册。

应用更新由应用宿主统一持有，按需加载 electron-updater，普通业务模块不能代为触发。默认无发布源、不查网络；自动检查 opt-in 只读版本，下载和安装分别确认，普通退出不自动安装。未签名本地包必须明确拒绝自替换。更新 IPC 仅主窗口开放，不把发行原始错误、路径或说明写入诊断。真实签名安装和 App Group 配置不在当前本地验收结果内。
