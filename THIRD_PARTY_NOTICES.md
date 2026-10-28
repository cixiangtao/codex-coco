# 来源与许可证

## 当前 UI 组件

packages/ui/src/components 中的基础组件由 shadcn CLI 4.22.1 从 [shadcn/ui](https://github.com/shadcn-ui/ui) 的 base-nova registry 生成。底层交互使用 Base UI，按上游 MIT 许可使用。shadcn 的完整授权条款保留于 [packages/ui/LICENSE.shadcn](packages/ui/LICENSE.shadcn)。

本轮新增 Empty 组件，并将其标题与说明分别调整为 h3/p 语义标签。定制包含语义颜色与状态、移除独立 dark 颜色覆盖、中文关闭文案，以及封装组件的局部 lint 说明。所有改动后的组件源码由本项目维护；base-nova 是当前工程实现起点，不代表最终视觉方案。

类名合并使用 [shadcn-ui/cn](https://github.com/shadcn-ui/cn) 的 cn npm 包，当前锁定 0.5.0，按随包 MIT 许可使用。UI 包不再直接依赖 clsx 和 tailwind-merge；其他依赖仍可能间接使用 clsx。

## 原型历史来源

已归档并移除的原型曾参考 [codex-usage](https://github.com/cixiangtao/codex-usage) 提交 b33578383a35b0f9d5d67fc67fbf98309b7702f5，及 [codex-skin](https://github.com/cixiangtao/codex-skin) 提交 9b88ab8a72417b9a69ac4dea1abda4f4a990c354。旧运行时和测试没有恢复到本轮新实现。

根目录 LICENSE 保留既有版权声明。二期按下述资产来源记录接入菜单栏素材；旧运行时仍未恢复。

## 首版用量读取

用量窗口与剩余比例的展示语义参考本地 codex-usage 上述提交中的 CodexUsageProvider.swift、Models.swift，按其 MIT 许可保留来源记录；该项目版权为 Copyright (c) 2026 cixiangtao，与根 LICENSE 一致。首版 TypeScript 实现重新编写，数据源改为 [OpenAI 官方 App Server 只读协议](https://learn.chatgpt.com/docs/app-server)。没有复制 Swift 网络/凭据读取、会话索引、重置卡实现或资产；不导入旧应用数据。测试使用新建的受控 stdio 服务与临时数据。

## 依赖和本地应用

Electron、React、Base UI、Tailwind、Oxc 工具等按各自随包许可使用，确切版本以 pnpm-lock.yaml 为准。本地应用目录包含 Electron 自带的 LICENSE 和第三方 Chromium 通知。正式发行前还需根据最终依赖和资产完善发行通知；当前不将本文件作为已完成的发行清单。

## 外观模块的 Codex 选择器与布景语义

`apps/desktop/src/modules/appearance/css.ts` 参考 codex-skin 的三层布景与 Codex DOM 选择器，来源为本地只读仓库 `codex-skin`，提交 `9b88ab8a72417b9a69ac4dea1abda4f4a990c354`。原项目使用 MIT 许可，Copyright (c) 2026 anys。适用 MIT 许可全文见 resources/licenses/codex-skin.txt；根 LICENSE 也保留该声明。

新实现使用 Codex Coco 自己的配置、内容寻址图片库、模块任务和 CDP 连接。未复制旧守护进程、HTTP 设置服务器或配置目录，不操作旧服务；新增菜单栏素材记录如下。样式节点和观察器使用独立标识，撤销仅删除 Codex Coco 自己的布景。`appearance/contract.ts` 的插画靠边锚点语义同样参考上述 MIT 来源的 `background-position.ts`；独立背景节点、缩略图与预览坐标处理由 Codex Coco 重写。新版数据属性与颜色变量另经本机已安装 webview 资源只读核对，没有复制客户端打包业务代码。

## 外观启动流程技术参考

2026-10-22 对照 [Codex Dream Skin](https://github.com/Fei-Away/Codex-Dream-Skin/tree/6fc42df48a6a5365011f55cc349e20c038e56d1d) 提交 `6fc42df48a6a5365011f55cc349e20c038e56d1d` 的 `macos/scripts/common-macos.sh`、`start-dream-skin-macos.sh` 与 `macos/tests/restart-cancellation.test.mjs`，核对新进程启动参数、已运行时先确认重启、拒绝退出不强制结束及确认前不改变现有状态的行为。其 macOS 代码采用 MIT，Copyright (c) 2026 Codex Dream Skin Studio contributors，[许可全文](https://github.com/Fei-Away/Codex-Dream-Skin/blob/6fc42df48a6a5365011f55cc349e20c038e56d1d/macos/LICENSE)。Codex Coco 仅采用 `open -n -a` 的启动方式并独立实现 TypeScript 生命周期、公开结果反馈和受控测试，没有复制上游脚本、启动服务、状态目录或素材，也不接管其他工具的守护进程。

## 本地用量计数语义参考

`modules/usage/local-index.ts` 的累计差值、初次 last_token_usage、fork 继承前缀与归档去重语义参考 codex-usage 同一来源提交（`b33578383a35b0f9d5d67fc67fbf98309b7702f5`，MIT，Copyright (c) 2026 cixiangtao）。实现为新的 TypeScript worker、独立有界索引和公开结果合同，没有复制 Swift 索引文件或读取旧应用配置。MIT 许可全文见根 LICENSE。

2026-10-22 另对照 [CodexBar](https://github.com/steipete/CodexBar) 提交 `932673aa68878faeee2847d5bf5767ca561fd8f0` 的 `docs/codex.md`、`CostUsageScanner.swift`、`CostUsageScanner+CodexFastJSON.swift` 及分页历史合同测试，参考其原生请求优先、镜像去重和分页续写的统计语义。来源采用 MIT，Copyright (c) 2026 Peter Steinberger。Codex Coco 独立实现 TypeScript 的文件分段合并、轮次关联、请求身份哈希、有界索引和测试；没有复制 Swift 代码、数据库或账户数据，没有添加 CodexBar 运行依赖。

2026-10-26 继续核对上述 CodexBar 提交的 `Providers/Codex/UsageStore+CodexRefresh.swift` 与 `Tests/CodexBarTests/CodexUsageFetcherFallbackTests.swift`，用于复核账号作用域、失败恢复与旧快照边界；对照上述 Codex Dream Skin 提交的 `macos/tests/restart-cancellation.test.mjs` 核对取消不改变原布景。没有复制新增上游源码或引入运行依赖。

## 固定样本题

用量工具中的糖果题数量与 21 基准参考 codex-usage 的 CodexIntelligenceCheck.swift（同上 MIT 来源提交与作者）。新实现重写问题提示、结构化输出、进程隔离与统计，并独立用动态规划核对期望值，没有迁回 Swift 运行时或界面代码。2026-10-26 另核对同提交的 `CodexIntelligenceHistory.swift` 与 `CodexIntelligenceCheck.swift` 的摘要字段和平均推理消耗；TypeScript 统计与同模型历史基线比较独立实现，旧应用历史和用户配置不迁入。

## gifuct-js

菜单栏 GIF 解码采用 gifuct-js 2.1.2（MIT，Copyright (c) 2015 Matt Way）及 js-binary-schema-parser 2.0.3。依赖只处理本地字节，不发起网络请求；重计算放在独立 worker。完整 gifuct-js 许可见 apps/desktop/resources/licenses/gifuct-js.txt，并随桌面资源分发。

## 菜单栏素材

菜单栏黑色线稿的可见像素、深色占比和色度判断参考 codex-usage 同一 MIT 来源提交中的 StatusBarController.swift。新的 TypeScript 实现对最多八帧采样，并额外支持透明底白色线稿；结果通过 Electron template image 交给系统着色。没有复制 AppKit/CALayer 运行时，彩色图继续原色渲染。

`apps/desktop/resources/tray/` 中的 19 个 GIF 从 codex-usage 的上述提交承接；原项目记录其来自 [BenignX/BuZhiYin](https://github.com/BenignX/BuZhiYin)，提交 `76aa03fdbdbc905ac42ee4afe9fed35dca351c6b`，MIT，Copyright (c) 2023 BenignX。完整授权见 resources/licenses/BuZhiYin.txt，随桌面资源分发。

pixel-cat 与 pixel-ghost 各四帧 PNG 从 codex-skin 同一来源提交的菜单栏像素素材导出，MIT，Copyright (c) 2026 anys；许可全文见根 LICENSE。GIF 解码、动画计时、CPU 联动、图片存储和系统适配由 Codex Coco 重写，没有复制两个旧应用的运行时。

## 外观图库素材

`apps/desktop/resources/backgrounds/` 的九个栅格文件来自 codex-skin 上述提交的 public/backgrounds，内容寻址后为八张不同图片。该仓库根许可证为 MIT，Copyright (c) 2026 anys；全文保留于 resources/licenses/codex-skin.txt，并随本地应用分发。Codex Coco 重写图库、预设、拖动定位和启动适配，没有迁回原设置服务器与守护进程。

## 应用更新

electron-updater 6.8.9（MIT，Copyright (c) 2015 Loopline Systems）用于手动下载、SHA-512 完整性校验与 macOS 原生签名安装；完整许可随 resources/licenses/electron-updater.txt 分发。依赖按 pnpm-lock.yaml 锁定，更新引擎按需加载，下载源固定为本仓库 GitHub Releases；默认手动检查，不在启动时联网，不自动下载或安装。GitHub 版本元数据解析由 Codex Coco 独立实现，不读取令牌。没有复制两个旧项目的自替换脚本。

## 图片尺寸读取

image-size 2.0.4（MIT，Copyright © 2013-Present Aditya Yadav）仅在桌面后台读取本地图片头部的宽高和 EXIF 方向，为原生异步缩略图保留宽高比；不执行网络请求，不解码完整图片，不把路径公开给界面。完整许可保留于 resources/licenses/image-size.txt，并随应用分发。

## 自定义主色选色器

UI 包使用 [react-colorful](https://github.com/omgovich/react-colorful) 5.8.1 的 HexColorPicker，采用 MIT，Copyright (c) 2020-present Vlad Shilov。完整许可保留于 resources/licenses/react-colorful.txt，随桌面资源分发。依赖版本锁定，仅在渲染器进行选色和键盘交互；Codex Coco 自行封装受控组件、主题样式、禁用状态与草稿保存流程，不复制上游源码。
