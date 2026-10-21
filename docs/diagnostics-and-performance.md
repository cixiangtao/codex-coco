# 本地诊断与性能采样

## 诊断边界

主进程创建 application/diagnostics.ts 的 DiagnosticLog，模块仅通过 DiagnosticSink 记录结构化事件。日志位于应用数据目录的 diagnostics/，没有网络发送、遥测或自动上传，也没有暴露给 renderer 的原始日志、文件路径或 Node API。

记录只包含格式版本、时间、会话 ID、事件、级别、结果状态，以及允许的操作、模块、运行代次、耗时和错误码。IPC 错误额外返回 correlationId；派发任务时该 ID 作为任务 ID，能对应 ipc.complete、task.start 与 task.finish。取消事件仍使用任务 ID，正常取消为 info，不记录成任务失败。

事件、错误码、阶段、配置健康状态和 IPC 通道均来自固定允许列表；模块与操作名只能来自静态注册表。关联 ID 必须为 UUID，数值必须有限且有界。服务会重新构造输出对象，不遍历或序列化输入/配置/结果、Error、堆栈、路径、URL、账号、正文或任意扩展字段。这里的级别由允许的事件状态计算，调用方不传自由文本消息。

现有记录点：应用启动与初始化、每个窗口第一次 ready 握手、IPC 完成/失败、模块阶段变化与配置加载健康、任务开始/取消/结算/不响应，以及应用退出。任务进度不逐次写日志。module.phase.durationMs 表示上一个阶段的停留时间；例如 starting → running 记录启动阶段耗时，不把长期 disabled 的停留时间解释为启动耗时。

## 文件、内存与退出限制

| 项目         | 默认上限                                        |
| ------------ | ----------------------------------------------- |
| 单条记录     | 1 KiB                                           |
| 单文件       | 256 KiB                                         |
| 文件保留     | 当前文件 + 两份归档，共不超过 768 KiB           |
| 内存队列     | 最多 256 条，且最多 128 KiB，包含正在写入的那条 |
| 退出排空等待 | 最多 1 秒                                       |

文件为 events.jsonl、events.1.jsonl、events.2.jsonl。按字节轮转，不等进程重启；文件使用 0600，新建目录使用 0700。重新打开时检查现有文件大小，并清理超过当前保留数量的本服务归档。超限的本服务日志会被删除以恢复上限，配置文件不受影响。

record 不等待磁盘，队列满时丢弃新记录，通过 status/flush 返回 dropped 计数；不会让队列无限增长。IO 失败清空队列并暂停本会话写入，只输出固定 DIAGNOSTICS_WRITE_FAILED，不输出文件路径或原始异常，应用和模块仍可继续运行。下次应用启动才重试日志初始化。

退出先停止模块和配置写入，再停止接收日志并限时排空。close/flush 的 completed 只表示应用层排空是否完成；写入失败要结合 failures/suspended 判断。它不是 fsync 或断电持久化保证。强制结束进程、磁盘失败或超过排空期限时，日志可能不完整。

## 采样命令

```sh
pnpm run verify:diagnostics
pnpm run profile:desktop
pnpm run profile:packaged
```

verify:diagnostics 验证真实 Electron 的错误关联 ID、敏感内容排除、窗口 ready 幂等，以及日志目录不可用时应用仍能操作和退出。verify:modules 同时检查任务日志关联和配置内容不落日志。

profile:desktop 先构建生产文件，再执行一次预热与默认三次重新启动。profile:packaged 重新生成 macOS arm64 应用目录，再测实际打包应用；两种模式分别输出 work/performance-baseline.json 与 work/performance-packaged.json，不混在同一个基线里。原始报告包含各进程样本和测量条件，属于本地忽略产物；仓库保存可读摘要，见 [性能基线](performance-baseline.md)。

脚本只在显式执行时采样，应用没有常驻采样定时器。每次启动使用全新的临时数据，结束后清理进程和数据。首次预热不计入统计；不清理操作系统缓存，因此不是冷缓存启动测试。可直接执行 node scripts/profile-desktop.mjs --runs=5 改变次数，允许 3–10 次，使用已构建的生产文件。

## 指标口径

- 外部启动耗时：脚本调用 Playwright 启动，到原生窗口可见且页面标题就绪，包含自动化连接和检查开销。
- appInitializationMs：主进程进入 start 到配置加载、模块恢复和 IPC 注册完成；不包含整个 Electron 进程初始化。
- firstWindowHandshakeMs：进入 createWindow 到 renderer 完成设置初始化、应用主题并发送 ready，随后调用 show。它不等于首帧实际绘制或用户感知启动耗时。
- 空闲采样：窗口就绪后等待 500 ms，再对一个约 1 秒的区间采样。单窗口场景取三次结果的中位数；双窗口、无窗口和合成模块对比各测一次。
- 进程范围：app.getAppMetrics 返回的 Browser、Tab、GPU、Utility 等全部相关进程，不只测主进程。报告按进程列出当前与历史峰值工作集，同时记录主进程活跃资源种类计数。[Electron ProcessMetric](https://www.electronjs.org/docs/latest/api/structures/process-metric)
- CPU：先取得区间起点；可用时以 cumulativeCPUUsage 差值计算，单核满载为 100%。新出现或缺少累计值的进程改用 Electron 区间值，并在报告标记口径；不把首次读取的零值当作稳定空闲结论。[Electron CPUUsage](https://www.electronjs.org/docs/latest/api/structures/cpu-usage)
- 内存：Electron 返回的 KiB 换算为 MiB，各进程工作集之和可能重复计算共享页面，不代表独占物理内存总量。macOS 不假造 Windows 专属 privateBytes 指标。[Electron MemoryInfo](https://www.electronjs.org/docs/latest/api/structures/memory-info)

测量覆盖正常单窗口、双窗口、macOS 无窗口后台。未打包模式还比较两个合成模块未启用、运行中及停用后的状态；打包模式始终关闭合成模块。活跃资源计数来自主进程，不证明所有进程或未来模块完全没有资源泄漏。

当前基线受机器、系统负载、缓存、自动化和采样时长影响。它用于后续在相近条件下比较变化，没有设性能预算，不声称跨设备性能达标、长时间稳定性或首帧零闪烁。
