# Codex Coco WidgetKit 扩展

此目录保留与旧项目相同的原生扩展交付能力，Electron 不能直接注册系统 Widget。源文件读取主程序的公开快照，不读取账号、令牌、数据库或对话。

在 Xcode 创建 macOS Widget Extension，将 CodexCocoWidget.swift 加入目标，最低部署 macOS 14。为宿主应用与扩展配置同一 Apple Team 和 App Group（推荐 group.dev.codex-coco.desktop，可通过扩展 Info.plist 的 CodexCocoAppGroup 覆盖）。设置页启用系统与菜单栏、选择该 Group Container 的实际目录、开启并应用共享快照。

主程序写入 codex-coco-widget.json，包含版本、共享状态、时间和白名单速览项。扩展每个时间线周期读取一次；WidgetKit 决定实际刷新时间，不承诺与菜单栏同频。停止共享后显示停止状态，超过十五分钟的额度明确提示过期。没有快照时不展示假额度。

当前本地仓库不包含 Apple Team、签名凭据或已安装的扩展，未签名 Electron 包不会自动获得 App Group entitlement。没有将源文件存在描述为系统 Widget 已安装。二期本地测试验证共享文件合同与停止写入，实际注册和签名需在配置 Apple Team 后验证。
