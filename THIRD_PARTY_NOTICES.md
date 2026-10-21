# 来源与许可证

## 当前 UI 组件

packages/ui/src/components 中的基础组件由 shadcn CLI 4.22.1 从 [shadcn/ui](https://github.com/shadcn-ui/ui) 的 base-nova registry 生成。底层交互使用 Base UI，按上游 MIT 许可使用。shadcn 的完整授权条款保留于 [packages/ui/LICENSE.shadcn](packages/ui/LICENSE.shadcn)。

定制包含语义颜色与状态、移除独立 dark 颜色覆盖、中文关闭文案，以及封装组件的局部 lint 说明。所有改动后的组件源码由本项目维护；base-nova 是当前工程实现起点，不代表最终视觉方案。

类名合并使用 [shadcn-ui/cn](https://github.com/shadcn-ui/cn) 的 cn npm 包，当前锁定 0.5.0，按随包 MIT 许可使用。UI 包不再直接依赖 clsx 和 tailwind-merge；其他依赖仍可能间接使用 clsx。

## 原型历史来源

已归档并移除的原型曾参考 [codex-usage](https://github.com/cixiangtao/codex-usage) 提交 b33578383a35b0f9d5d67fc67fbf98309b7702f5，及 [codex-skin](https://github.com/cixiangtao/codex-skin) 提交 9b88ab8a72417b9a69ac4dea1abda4f4a990c354。旧运行时和测试没有恢复到本轮新实现。

根目录 LICENSE 保留既有版权声明。没有复制旧项目主题图片或 BuZhiYin GIF 集合；以后引用代码或资产时重新记录来源与许可。

## 依赖和本地应用

Electron、React、Base UI、Tailwind、Oxc 工具等按各自随包许可使用，确切版本以 pnpm-lock.yaml 为准。本地应用目录包含 Electron 自带的 LICENSE 和第三方 Chromium 通知。正式发行前还需根据最终依赖和资产完善发行通知；当前不将本文件作为已完成的发行清单。
