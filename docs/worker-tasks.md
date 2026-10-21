# 工作线程任务

2026-10-21：已接入按任务创建的 Node Worker 执行器。主进程继续管理模块状态、配置和任务截止时间；模块可把文件解析或重计算委托给独立线程，不需要增加 IPC 通道或修改页面合同。

## 执行与资源归属

`application/worker-task.ts` 提供 `runWorkerTask(createWorker, request, context)`。主进程组合根注入固定入口的 Worker 工厂，模块调用执行器并传入本次任务的输入、配置快照、取消信号和进度回调。入口路径不来自 renderer、用户配置或下载的脚本。

每次调用创建一个线程，任务结束后释放，不保留空闲线程或线程池。ModuleHost 仍限制每个模块只有一个在途任务，不同模块可并行；保存配置和窗口切换不等待线程内的长操作。

成功结果、异常、非法消息和取消都会进入同一个清理路径。执行器等待线程退出后才结算；即使线程陷入同步循环，取消也会调用 `terminate()`。如果终止调用失败，仍等待真实 exit，宿主的清理截止时间负责将未退出的任务标记为无响应，不能将其报告为干净停用。后续消息与重复结算被忽略。

没有主线程回退。创建失败、线程崩溃和协议错误以固定内部错误标记失败，ModuleHost 继续映射为已有的公开任务错误。原始异常、堆栈和消息不写入公开结果或诊断日志。Worker 是执行位置与生命周期边界，不是外部不可信代码的权限沙箱。

## 消息合同

主线程向新线程发送一次 JSON 请求。模块决定请求结构并在 worker 中按自身合同校验。worker 只返回以下严格消息：

```ts
{ type: "progress", value: 50 }
{ type: "result", value: { completed: 2 } }
{ type: "error" }
```

进度必须是 0–100 的有限数字，结果必须是 JSON 值。每条返回消息序列化后最多 1 MiB，不接受循环引用、BigInt、Date 或额外字段。终端错误只允许 `type`，不携带原始异常。模块公开输出仍由操作自己的 schema 再校验，执行器不会替模块判断结果中的业务字段是否适合公开。

worker 收到请求后完成单次任务并关闭自己的端口。执行器还会终止残留定时器等资源，防止已返回结果的线程继续驻留。

## 构建与接入

合成示例的 `modules/foundation-fixture/worker.ts` 是 Electron 主进程构建的独立入口，输出为 `out/main/foundation-worker.js`；共享依赖由构建生成 chunks。组合根使用构建目录中的固定路径创建 Worker，模块 runtime 不依赖 Electron。

Node 24 合同测试直接运行相同的 worker 源码，测试适配器位于 `tests/support/fixture.ts`。worker 源码显式导入 `.ts` 合同，主进程专用 tsconfig 开启 `allowImportingTsExtensions`；生产代码仍由 electron-vite 构建，不要求用户运行 TypeScript 源文件。

正常启动与打包应用始终不注册合成模块。`CODEX_COCO_FIXTURES=1` 只在未打包验证时启用示例。打包文件保留线程入口供构建验收；`verify-workers` 通过测试宿主直接验证该资源，不改变模块注册策略或公开权限。

## 验证与范围

```sh
pnpm run check
pnpm run verify:modules
pnpm run verify:workers
pnpm run verify:packaged
```

合同测试覆盖真正的 Node Worker：成功后退出、非法与超大消息、循环结果、异常脱敏、无结果退出、启动失败、提前取消、同步阻塞取消、观察者异常、线程互不阻塞、终止失败时保留等待，以及宿主超时/停用/退出的清理。

`verify:modules` 从真实 Electron 页面验证两个独立模块的进度、配置快照、取消、重新启用、跨窗和重启恢复；`verify:workers` 验证构建出的入口、进度、结果与实际退出，打包回归也执行相同资源验收。所有检查使用临时数据，结束后清理。

当前只验证了合成任务，不代表用量扫描或外观引擎已接入。没有新增常驻轮询，未重新采样性能；局部主题作用域与真实业务仍待后续。
