# Codex Coco UI 组件包

私有包 `@codex-coco/ui`，由桌面应用通过 `workspace:*` 依赖；直接消费源码，不单独打包或发布。

当前接入 shadcn CLI 4.22.1 的 base-nova / Base UI 组件源码，并定制语义状态和中文关闭文案；类名工具使用 cn npm 包。包含 Button、Input、Field、ToggleGroup、Dialog、Tooltip、Alert、Separator 等基础控件。工程预设与验证页不是最终视觉基线。

## 公开入口

```tsx
import { Button } from "@codex-coco/ui/components/button";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { defaultTheme } from "@codex-coco/ui/theme/contract";
import "@codex-coco/ui/styles.css";

export function Example() {
  return (
    <ThemeProvider preference={defaultTheme}>
      <Button>示例按钮</Button>
    </ThemeProvider>
  );
}
```

- `components/*`：控件。
- `theme`：文档根受控 ThemeProvider、applyTheme 与 useResolvedTheme。
- `theme/contract`：纯类型、默认值、模式/预设列表与 HEX 归一化。
- `theme/resolve`：纯 token 解析与对比度计算。
- `styles.css`：Tailwind、语义映射与基础样式；从应用唯一 CSS 入口导入，再显式注册应用自己的源码扫描。

组件直接通过 `import { cn } from "cn"` 使用类名工具，不在 UI 包内封装或重导出。两个 shadcn 配置的 `aliases.utils` 均指向 `cn`。

Tooltip 使用 `TooltipProvider`、`Tooltip`、`TooltipTrigger` 和 `TooltipContent` 组合；通过 Trigger 的 `render` 复用 Button，避免嵌套按钮。应用决定延迟和方向，组件使用共享主题的反差表面，保留悬停、键盘聚焦与 Esc 关闭能力；图标触发器仍需提供可访问名称。

React 和 React DOM 由 peerDependencies 与应用统一。组件包不依赖 Electron、Node、IPC、业务或配置服务。Provider 不自行持久化，应用负责草稿、保存、取消、版本冲突和多窗口同步。

当前 Provider 作用于文档根，body 上的弹层继承同一主题。独立局部主题预览及其 portal 容器尚未实现，不要把根 Provider 用作多个不同主题的嵌套预览。

新增组件通过 `pnpm dlx shadcn@4.22.1 add <名称> --cwd packages/ui`，先检查 info/docs 与生成文件，不自动覆盖已有控件。保持主题变量和组件变体统一，业务复合组件留在应用。

[主题方案](../../docs/ui-package-and-theme.md) · [shadcn 许可证](LICENSE.shadcn)
