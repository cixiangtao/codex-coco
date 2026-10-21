# 当前架构与模块边界

2026-10-21：新基建已从零实现，可运行真实 Electron 和本地应用目录。当前界面用于验证工程能力；没有用量或外观业务模块，正式布局仍待评审。

## 目录

```text
apps/desktop/
  src/desktop/main/      窗口、协议、IPC、菜单、退出与系统适配
  src/desktop/preload/   沙箱 CJS 桥，只暴露固定方法
  src/application/      模块生命周期与 SettingsStore
  src/contracts/        纯数据合同、Zod 校验与 IPC 通道定义
  src/renderer/         React 验证页、设置客户端与本地预览
  src/modules/registry  内置模块注册，当前为空
packages/ui/
  src/components/       自有 shadcn 组件源码
  src/theme/            纯主题合同/解析、根 Provider
  src/styles/           共享 CSS 和 Tailwind 映射
scripts/                AST 边界检查、真实桌面回归
tests/                 配置、模块、主题、安全和边界合同测试
```

Electron、应用服务、renderer、UI 包各有明确职责；UI 包通过公开导出使用。TypeScript 对主进程、preload、纯合同、renderer 和 UI 包分别检查，Node 类型不进入纯合同或 UI 配置。工具和测试另有类型配置。

## 进程和权限

主进程组合模块管理器、配置服务与窗口。preload 将 bootstrap、saveTheme、resetSettings、ready 和设置订阅映射到固定通道，不透出原始 IPC 或事件。IPC 校验已注册 webContents、主 frame、精确页面地址与输入结构。

renderer 开启 sandbox、contextIsolation，关闭 nodeIntegration 和 webview；弹窗和权限请求默认拒绝。生产内容由受限 app:// 协议加载，限制 host、方法和路径，并设置 CSP。打包后的应用忽略开发 URL，开发 URL 只接受本机 HTTP。外部导航被阻止。

单实例锁以当前 userData 隔离进程，多个窗口共用一份配置服务。macOS 关闭窗口释放 renderer，Dock 激活时重开；退出时停止模块并等待配置队列。

## 配置与主题

SettingsStore 保存 schemaVersion、revision 与 theme。Zod 同时校验模式、预设、颜色和写入 revision；序列化写入前合并最新保存状态，临时文件以私有权限创建并原子替换。并发旧 revision 保存返回 CONFLICT，不覆盖其他窗口结果。

当前版本为 1；测试提供合成 v0 迁移样本，不表示支持导入原型设置。迁移和显式恢复先备份原文件。损坏或未来版本配置不自动改写，使用默认主题显示恢复入口；IO 权限错误则明确启动失败。

应用维护保存快照；每个 renderer 持有自己的预览草稿。取消恢复最新保存快照，保存成功后广播；有草稿的其他窗口保留预览并显示冲突。订阅先于 bootstrap 建立，旧 revision 推送不能回退状态。

UI 包只维护组件、语义变量与受控 Provider。纯主题子路径可由后台和合同消费，不加载 React。窗口在有效主题应用后显示，原生背景按保存模式匹配；Dialog 挂到 body 并继承根主题。独立局部主题作用域尚未实现。

## 模块生命周期

ModuleDefinition 以稳定 ID 注册，start 接收 AbortSignal 并返回异步清理函数。ModuleManager 按模块串行启停，不同模块不共享长任务队列；状态包含 phase、generation 和错误码。

排队中的启用也可取消；重复启用不重复获取资源。启动和停止有截止时间；迟到启动结果会执行自己的清理，超时或清理失败保持 error，不能报告成 disabled。shutdown 阻止新启用、取消资源并收集各模块结果。错误状态不盲目重启，需要恢复方案或重开应用。

示例模块只在合同测试中注册，用来验证独立接入和故障隔离。业务操作分发、模块专属配置迁移、工作线程任务服务与有界诊断日志仍需在后续基建迭代落实。

## 自动边界检查

Oxlint 检查 TS、React 和可访问性基础规则；封装 Label/Field 的两处静态误报仅作局部豁免，调用处仍受检查。

Oxc parser 读取 AST，检查静态、类型、动态导入和 require，并解析相对路径及包导出。检查阻止 renderer/UI 导入 Node 或 Electron、纯合同导入 UI 运行时代码、UI 导入应用、application 导入 Electron/React、模块跨目录调用其他模块。动态非字面量加载被拒绝。当前应用没有自定义路径别名导入；未来新增别名时须同步解析规则并增加反例测试。

[基建计划](foundation-plan.md) · [验证记录](verification.md)
