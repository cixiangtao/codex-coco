# Codex Coco 桌面应用

Electron + React + TypeScript 桌面宿主。当前包含基建验证页、白名单 IPC、版本化主题配置与内置模块生命周期、操作分发和独立配置管理；业务模块注册表为空。

从根目录运行 `pnpm run dev`、`pnpm run build`、`pnpm run start`。本包独立检查主进程、preload、纯合同和渲染器类型；UI 通过 `@codex-coco/ui` 的公开导出消费。

默认数据目录在 Codex Coco/foundation 下；`CODEX_COCO_DATA_DIR` 可用于隔离验证。关闭最后窗口后 macOS 进程保留，可从 Dock 重新打开；退出时关闭模块并等待配置队列。窗口可通过菜单或 Cmd+N 新建，共享保存的配置 revision。

不读取真实账号，不请求额度，不连接外部 Codex。详见 [架构约定](../../docs/architecture.md) 与 [开发验证](../../docs/verification.md)。

`pnpm run verify:modules` 使用临时目录和显式开启的合成模块验证完整链路。普通启动和打包应用均不注册示例。后台、纯合同与页面的接入方式见 [模块开发](../../docs/module-development.md)。

本地诊断使用固定字段和文件/队列上限，错误经关联 ID 对应日志；不记录配置值或原始异常。显式性能采样命令为 profile:desktop / profile:packaged，详见 [诊断与性能](../../docs/diagnostics-and-performance.md)。
