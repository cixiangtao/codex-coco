# 模块技术参考约定

2026-10-22，IKUN同学确定以下长期技术参考。后续开发、排查缺陷和核对边界行为时，优先查阅对应项目的源码、技术文档与测试。

| Codex Coco 模块                             | 主要技术参考                                                              | 优先核对的技术问题                                                                                   |
| ------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 外观（skin，代码目录 `modules/appearance`） | [Fei-Away/Codex-Dream-Skin](https://github.com/Fei-Away/Codex-Dream-Skin) | 本机 CDP 连接与注入、背景定位与缩放、DOM 适配、主题应用与恢复、资源校验                              |
| 用量（usage，代码目录 `modules/usage`）     | [steipete/CodexBar](https://github.com/steipete/CodexBar)                 | Codex 数据源与统计口径、账号隔离、额度周期与重置时间、本机日志扫描与去重、缓存与失败恢复、菜单栏展示 |

## 查阅入口

- 外观：从上游 [README](https://github.com/Fei-Away/Codex-Dream-Skin#readme)、[macOS 目录](https://github.com/Fei-Away/Codex-Dream-Skin/tree/main/macos) 和 [平台说明](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/docs/platforms.md) 进入，按具体问题继续定位实现和测试。
- 用量：从上游 [Codex 数据源说明](https://github.com/steipete/CodexBar/blob/main/docs/codex.md)、[Sources](https://github.com/steipete/CodexBar/tree/main/Sources) 和 [Tests](https://github.com/steipete/CodexBar/tree/main/Tests) 进入。本机统计已有对照记录见 [本机用量统计核对](usage-statistics.md)。

上述分支链接用于查找最新入口；形成具体实现结论时，记录实际核对的 commit、文件和行为，避免将滚动分支当作固定证据。

## 在本项目中使用参考

1. 先明确本次问题和数据口径，对照上游实现与测试，记录可借鉴的行为、适用条件及与 Codex Coco 的差异。
2. 实现继续使用本项目的 Electron、TypeScript、模块生命周期、worker 与桌面桥合同。上游技术方案需要适配这些边界；界面沿用已确定的自有组件和布局规范。
3. 数据源与权限遵循本项目已有约定。当前本机统计修复仍只覆盖本机数据；新增账号服务端统计、凭据访问或其他权限应按对应任务明确范围。
4. 实际复用或改写代码、选择器、算法或资产时，在 [来源与许可证](../THIRD_PARTY_NOTICES.md) 记录仓库、固定 commit、文件、许可证、保留的声明与实现差异。按所用文件及资产核对授权；仓库代码许可不代替图片等资产的独立授权。上游许可入口：[Codex Dream Skin LICENSE](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/LICENSE)、[macOS LICENSE](https://github.com/Fei-Away/Codex-Dream-Skin/blob/main/macos/LICENSE)、[CodexBar LICENSE](https://github.com/steipete/CodexBar/blob/main/LICENSE)。
5. 将借鉴的行为转为本项目可复现的合同测试；涉及界面或桌面生命周期时，执行对应的真实 Electron 验证。

## 与现有记录的关系

本约定确立后续技术参考方向；本次仅记录约定，没有引入上游代码、资产或运行依赖。已有 codex-usage、codex-skin 和 CodexBar 的实际复用来源继续保留在来源记录中。

二期能力目标继续由 [二期能力清单](phase-two.md) 追踪，实现状态与验证证据继续由 [验证记录](verification.md) 追踪。技术参考不自动扩展为上游全部功能的迁移承诺，也不能作为某项能力已经实现或通过验收的依据。
