# Codex Coco 产品约定

<!-- impeccable:product-schema 1 -->

## Platform

web

这里表示 Electron 内的网页渲染技术；产品是桌面应用，首期验证 macOS，不是网站，也尚未承诺 Windows/Linux 兼容。

## Stack

Electron、React、TypeScript；Tailwind CSS + shadcn/ui 构建自有组件；pnpm workspace 管理依赖；Oxc 的 Oxfmt 格式化，Oxlint 代码检查，Oxc parser 检查依赖边界。

桌面应用位于 `apps/desktop`，私有 UI 包位于 `packages/ui`。当前已接入可运行 Electron、白名单桌面桥、模块/配置基础、共享组件与受控主题；验证页不代表最终产品界面。

## Users

首要用户是维护者自己，日常使用 Codex，重视菜单栏信息、操作习惯与外观体验。

## Product Purpose

一个按自己习惯打磨的 Codex 桌面伴侣。计划整合 codex-usage 和 codex-skin 的能力，保留更多模块的扩展空间。自我学习与成就感是明确的项目价值。

## Capabilities and Constraints

- 2026-10-21 已移除技术原型，从新基建开始。当前可运行基建验证页，没有用量或外观业务功能；工程与主题基础落实后继续评审架构与正式界面。
- 目标是一个应用、一个菜单栏入口，首批模块为用量与外观；模块独立启停、独立配置和状态，共享桌面基础。
- Codex Coco 自身 UI 支持浅色、深色、跟随系统、主题预设和自定义主色；具体视觉方向待评审，与外部 Codex 布景功能独立。
- 先使用内置模块，不提前引入第三方动态插件系统。
- 旧仓库和已有应用数据保留，不自动导入配置、接管守护进程或修改旧应用。
- 用户选择先只保留本地仓库；README 中文为主，附英文说明，界面中文。
- 不承诺原型业务功能已在新实现中恢复。实现进度见 [功能重建计划](docs/migration.md)。

## Brand Commitments

应用、文档、通知和发布说明使用完整名称 **Codex Coco**；仓库名为 `codex-coco`。没有已确定的 Logo、吉祥物或视觉品牌。用户未认可原型的整体审美；原型布局、绿色配色、双 C 标记和 Ant Design 不构成设计约束。

后续评审完整窗口组合，再确定字号、间距、色彩和控件规则，不把更换组件库当作设计问题已解决。

## Evidence on Hand

本地旧项目可作为行为和实现参考。原型清理前已归档，其测试和截图只属于历史记录。新基建具备单元与真实桌面验证记录、未签名本地应用目录；已建立本机性能参考基线，尚无正式安装包或跨设备性能预算。

## Product Principles

1. 自己用着舒服，比功能数量更重要。
2. 能理解、验证和恢复后台行为。
3. 一个模块失败时，其他模块仍能使用。
4. 从明确边界开始，小步实现并如实记录完成度。
