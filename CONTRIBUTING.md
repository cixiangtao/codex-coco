# 贡献指南

感谢参与 Codex Coco。项目以维护者日常使用、学习和持续打磨为目标，目前优先支持 macOS，界面和主要开发文档使用中文，[英文 README](README.en.md) 维护稳定的功能与开发说明。

## 开始开发

使用 Node.js 24 和 package.json 锁定的 pnpm 12.14.0，不修改全局包管理器配置。

```sh
pnpm install --frozen-lockfile
pnpm run dev
pnpm run check
```

开发与验收使用 `CODEX_COCO_DATA_DIR` 隔离数据，避免误操作正在使用的配置。真实 Electron 专项验证见 [README](README.md) 和 [验证记录](docs/verification.md)；受控 CLI、模型、兑换与更新测试不使用真实账号消费或真实升级。

## 提交修改

- 较大的行为或架构调整先开 Issue 讨论，说明具体场景与验收方式。
- 一个 PR 聚焦一个意图，附行为变化、检查命令与结果；界面变化附脱敏截图。
- 提交信息采用 Conventional Commits，例如 `fix(usage): 🐛 修复额度恢复状态`。
- 改变生命周期、数据解析或 IPC 时增加合同测试；界面交互用真实 Electron 验证。
- 遵循 [AGENTS.md](AGENTS.md) 和 [架构说明](docs/architecture.md) 的进程、模块和隐私边界。
- 不提交凭据、账号内容、模型回答、本机配置、日志或构建产物。引用代码和素材时同步来源、许可证与修改说明。

CI 执行格式、代码与边界检查、类型检查、合同测试及生产构建。它不发布应用，也不能证明签名、公证、真实更新安装或所有 macOS 版本兼容。

## 依赖与发行

依赖使用精确版本，只保留 pnpm-lock.yaml。常规依赖升级保持人工选择，安全修复也需要审查和检查，不自动合并。源码推送不触发版本发布；当前没有正式签名发行流程，后续可自动化的正式发布由 GitHub Actions 统一执行。

安全问题请按 [安全策略](SECURITY.md) 私密报告，不在公开 Issue 中粘贴敏感信息。
