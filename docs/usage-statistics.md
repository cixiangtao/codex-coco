# 本机消耗与客户端每日统计

核对日期：2026-10-22。本次修复本机计数，未将客户端个人资料的数据混入本地趋势，也未增加账号网络请求。

## 已确认的问题与修复

1. 旧实现对同一 session 只保留计数记录最多的一个文件。真实续聊可以分多个文件保存，因此新分段会被当作副本丢掉。现在合并分段后按事件身份去重，再重算累计差值。
2. 新版 `token_usage_record` 以前被完全忽略。现在按所属 thread 和 response 的哈希计数，同一轮次使用原生请求值，不重复加上 `token_count` 镜像。旧轮次保留累计差值兼容；分叉里的父线程请求不计入子线程。
3. 首个 last 值为零时，旧代码会用整个累计值替代零。现在保留有效零值，索引版本升级到 3，旧缓存自动重建。
4. 显式扫描以前可能直接返回十分钟内的内存结果。现在手动扫描绕过内存缓存，文件本身仍按追加偏移增量读取；自动读取保留既有缓存策略。

## 客户端个人资料的来源

本机安装的客户端资源中，个人资料查询从 `/wham/profiles/me` 读取 `stats.daily_usage_buckets`，把 `tokens` 和 `start_date` 映射为每日图表。它是服务端返回的统计，不能用“当前目录内 JSONL 的总和”直接替代。

只读静态证据：

- `/Applications/ChatGPT.app/Contents/Resources/app.asar` SHA-256：`9d0260dd37f9c45546d5a89d9d782b8362c9957b70b992e2c3f91df60a046b07`。
- 资源 `webview/assets/app-initial-f3e281fb9a71.js` SHA-256：`a9906c234f7dfb2f59785b40f9b489d6ce509205c58ce9fd53bdfea68b1d8252`，与 ASAR 声明的该 JS 哈希一致。
- `t6o` 函数的 UTF-8 字节范围为 `[7971737, 7972462)`；查询、字段映射及十分钟缓存来自同一条调用链。没有复制客户端实现或执行提取代码。
- REA 对完整安装包建立了静态身份记录；对所选 14 MB JS 的 AST 分析触及资源限制，因此不能把其图覆盖描述为完整。上述字段链路另外直接读取已校验的静态字节核对，未观察或请求真实账号响应。

这些证据只确认客户端数据源及字段映射，没有确认服务端使用的时区、设备范围、任务覆盖和延迟。不能仅因数值不同就断言差额全部来自远程任务，也不能用倍率或 SQLite 生命周期累计量补齐每日值。

当前本机统计只覆盖所选数据目录内可读且支持的记录，按本机日历日期归集；不可读、超限或损坏情况保留“不完整”提示。请求总量不额外叠加缓存输入和推理输出子项。SQLite 仅为无 JSONL 时的线程累计估算，继续明确标记，且不与事件统计混加。

## CodexBar 对照范围

参考 [CodexBar 的 Codex 说明](https://github.com/steipete/CodexBar/blob/932673aa68878faeee2847d5bf5767ca561fd8f0/docs/codex.md)、[原生扫描实现](https://github.com/steipete/CodexBar/blob/932673aa68878faeee2847d5bf5767ca561fd8f0/Sources/CodexBarCore/Vendored/CostUsage/CostUsageScanner.swift) 和 [分页历史测试](https://github.com/steipete/CodexBar/blob/932673aa68878faeee2847d5bf5767ca561fd8f0/Tests/CodexBarTests/CodexPaginatedHistoryAccountingTests.swift)。来源与 MIT 许可记录在根目录 THIRD_PARTY_NOTICES.md。

本轮采用分段合并、原生请求优先及镜像去重的语义，继续使用 Codex Coco 自己的 worker 与配置边界。没有接入 CodexBar 的其他提供商、计价、SSH 导入、凭据复用或网页统计链路，不把对照检查说成完成其全部能力迁移。
