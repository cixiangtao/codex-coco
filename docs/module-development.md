# 内置模块接入

当前实现静态内置模块，不加载外部插件。业务注册表为空；foundation-fixture 仅用于开发与测试，正常启动不注册，打包应用忽略 CODEX_COCO_FIXTURES 开关。

## 接入位置

1. 在 apps/desktop/src/modules/<id>/contract.ts 定义纯配置、操作输入和公开结果 schema。此文件不可依赖 Node、Electron、React 或后台。
2. 在模块 runtime.ts 实现 application/module-host.ts 的 BuiltinModule：稳定 ID、标题、配置版本/默认值/校验/迁移、操作白名单和启动函数。
3. 在 modules/registry.ts 的 moduleDefinitions 注册后台定义。主窗口和 IPC 网关不增加模块专属分支。
4. 如需页面，在模块 renderer/ 中实现，按 renderer/module-pages.ts 的组件合同接收 ModuleSnapshot 并注册页面。页面只消费纯合同与桌面客户端，不导入 runtime.ts。

目录按职责创建，不要求提前建立空文件。参考现有 foundation-fixture 的合同、运行时与页面。

## 操作与资源归属

start 接收模块 AbortSignal，返回 execute 和 stop。模块拥有自己的监听、定时器及其他资源，stop 必须释放这些资源；启动中断或失败的实现须自行释放尚未交给宿主的资源。

execute 接收固定操作名、已校验的输入和 OperationContext。上下文包含独立取消信号、派发时的配置副本，以及 0–100 的进度报告。返回值还会经过该操作声明的公开输出 schema 校验。异常统一映射成 TASK_FAILED，原始异常不经 IPC 返回。

每个模块同时运行一个操作，重复操作返回 MODULE_BUSY；不同模块可并发，配置写入不等待长任务。runModuleOperation 立即返回带任务 ID 的快照，最终结果通过 moduleChanged 推送，也可从 modules 获取。每模块只保留当前或最近一次任务，下一次操作替换它，不提供历史队列。

cancelModuleOperation 必须匹配模块与任务 ID。取消是请求，先进入 cancelling，任务实际结算后才进入 cancelled。模块停用和应用退出也会取消任务。截止时间到达会取消并报告 TASK_TIMEOUT；取消后仍不结算则报告 TASK_UNRESPONSIVE，隔离该运行时，清理失败保持 error。宿主不会终止其他应用，也不把 Promise 超时当作资源释放成功。

状态推送包含模块 ID、单调 revision 与 generation。窗口先订阅再取初始快照，拒绝旧快照；关闭窗口只释放订阅，后台任务继续由宿主管理。

当前任务执行在主进程的异步路径。文件重扫描、计算密集操作必须先补齐 worker 适配，不能在 execute 中执行阻塞工作。

## 独立配置

配置保存于应用数据目录的 modules/<id>.json：

```json
{
  "schemaVersion": 1,
  "revision": 2,
  "enabled": true,
  "value": { "label": "合成任务" }
}
```

此处只存可公开的偏好；配置会进入窗口快照，凭据、令牌或私有数据不得放入 value。每个模块有独立文件和写入队列，写入以最新 envelope 合并 requested 字段，临时文件原子替换原件。保存 value 要带 expectedRevision，过期保存返回 CONFLICT；启停只更新 enabled，不覆盖同时保存的 value。

enabled 是用户持久化的启用意图，与运行时 phase 分开。退出会释放资源并保留意图，重启按有效配置恢复；启动失败显示 error，不把意图当作已经运行。任务使用派发时的配置，保存变更供下一次操作使用；当前合同不支持自动重启运行时或热更新常驻服务配置，新增此需求时单独定义应用策略。

migrations[n] 将 value 从版本 n 转为 n+1；宿主依序运行直到当前版本，再校验、备份和写入。缺少步骤、损坏或未来版本时保留原文件，模块保持停用；显式恢复会先备份原件、写入默认值并保持停用。读取或迁移落盘遇到 IO 错误时标记该模块配置 unavailable，保留原路径并允许其他模块继续启动。迁移样本只覆盖新基建自己的合成版本，不承诺旧项目数据导入。

## 验证

```sh
pnpm run check
pnpm run verify:modules
pnpm run verify:desktop
```

verify:modules 自动设置未打包环境的 CODEX_COCO_FIXTURES=1 和临时 CODEX_COCO_DATA_DIR，验证两个合成实例。测试覆盖操作白名单、参数校验、进度、配置更新、取消、停用/重新启用、跨窗口冲突、无窗口后台运行、重启和损坏恢复，结束后清理进程与临时数据。合成配置迁移、无响应取消与输出脱敏另由合同测试覆盖。

有界日志、性能基线、worker 服务、模块私有数据服务与正式产品界面尚未实现。本轮完成的是模块接入闭环，不代表全部基建目标完成。
