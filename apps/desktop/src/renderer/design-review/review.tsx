import { useState, type ComponentType, type ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronDown,
  Clock3,
  Layers3,
  Monitor,
  Palette,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { cn } from "cn";
import { Button } from "@codex-coco/ui/components/button";
import { Input } from "@codex-coco/ui/components/input";
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@codex-coco/ui/components/field";
import { ToggleGroup, ToggleGroupItem } from "@codex-coco/ui/components/toggle-group";
import { Alert, AlertDescription, AlertTitle } from "@codex-coco/ui/components/alert";
import { ThemeProvider } from "@codex-coco/ui/theme";
import { normalizePrimaryColor } from "@codex-coco/ui/theme/contract";

const directions = {
  sidebar: {
    name: "A · 精简侧栏",
    title: "导航更轻，内容优先",
    description: "常用模块在上，管理与设置在下。",
    tradeoff: "侧栏可收起，完整能力留在当前页面。",
  },
  topbar: {
    name: "B · 顶部导航",
    title: "打开就看重点",
    description: "把空间还给内容，阅读从额度到恢复时间。",
    tradeoff: "适合快速查看和少量常用模块；模块变多后需要收进模块页。",
  },
  workbench: {
    name: "C · 工具台分栏",
    title: "信息与操作并排",
    description: "主区看数据，右侧保留账号与当前状态。",
    tradeoff: "适合主窗口常开和密集操作；小窗口需要折叠右侧信息。",
  },
} as const;
type Direction = keyof typeof directions;
const pages = [
  { id: "usage", label: "用量", icon: Activity },
  { id: "appearance", label: "外观", icon: Palette },
  { id: "modules", label: "模块", icon: Layers3 },
  { id: "settings", label: "设置", icon: Settings2 },
] as const;
type Page = (typeof pages)[number]["id"];
const states = {
  normal: "正常",
  empty: "未连接",
  error: "更新失败",
  dense: "多账号长文案",
} as const;
type ReviewState = keyof typeof states;
interface ModuleFlags {
  usage: boolean;
  appearance: boolean;
}
interface SurfaceProps {
  state: ReviewState;
  notify(message: string): void;
}

function Navigation({
  page,
  onChange,
  compact = false,
}: {
  page: Page;
  onChange(page: Page): void;
  compact?: boolean;
}) {
  return (
    <nav className="app-navigation" aria-label="应用导航">
      {pages.map(({ id, label, icon: Icon }) => (
        <Button
          key={id}
          variant={page === id ? "secondary" : "ghost"}
          aria-current={page === id ? "page" : undefined}
          aria-label={compact && id === "modules" ? "模块管理" : label}
          title={compact && id === "modules" ? "模块管理" : label}
          className={cn("nav-item", compact && id === "modules" && "nav-utility-start")}
          onClick={() => onChange(id)}
        >
          <Icon data-icon="inline-start" />
          <span>{compact && id === "modules" ? "模块管理" : label}</span>
        </Button>
      ))}
    </nav>
  );
}
function Account({ dense = false }: { dense?: boolean }) {
  return (
    <div className="account-line">
      <span className="account-avatar">
        <UserRound aria-hidden="true" />
      </span>
      <div className="account-name">
        <strong>{dense ? "个人开发与开源项目专用账号" : "个人账号"}</strong>
        <span>Plus · 已连接</span>
      </div>
      <ChevronDown className="standalone-icon" aria-hidden="true" />
    </div>
  );
}
function Status({ warning = false, children }: { warning?: boolean; children: ReactNode }) {
  return (
    <span className={cn("status-text", warning && "status-warning")}>
      {warning ? <TriangleAlert aria-hidden="true" /> : <Check aria-hidden="true" />}
      {children}
    </span>
  );
}
function Quota({ title, remaining, reset }: { title: string; remaining: number; reset: string }) {
  return (
    <section className="quota-block" aria-label={title}>
      <div className="quota-title">
        <span>{title}</span>
        <span className="quota-caption">剩余额度</span>
      </div>
      <div className="quota-number">
        {remaining}
        <span>%</span>
      </div>
      <meter
        className="quota-track"
        aria-label={`${title}剩余额度`}
        value={remaining}
        min={0}
        max={100}
      />
      <p className="quota-reset">
        <Clock3 aria-hidden="true" />
        {reset}
      </p>
    </section>
  );
}
function Usage({ state, notify }: SurfaceProps) {
  const [showPrevious, setShowPrevious] = useState(false);
  const empty = state === "empty";
  return (
    <div className="usage-page">
      <header className="page-heading">
        <div>
          <h1>用量</h1>
          <p>留意余量，安心继续手头的工作。</p>
        </div>
        <Button variant="outline" onClick={() => notify("刷新演示完成，当前仍为合成数据。")}>
          <RefreshCw data-icon="inline-start" />
          刷新
        </Button>
      </header>
      {empty ? (
        <section className="empty-content">
          <UserRound aria-hidden="true" />
          <h2>先连接你的账号</h2>
          <p>连接后，在这里查看剩余额度与下次恢复时间。</p>
          <Button onClick={() => notify("连接流程尚未实现；此处仅演示入口位置。")}>
            连接账号
            <ArrowUpRight data-icon="inline-end" />
          </Button>
        </section>
      ) : (
        <>
          <div className="usage-context">
            <Account dense={state === "dense"} />
            <span className="updated-at">上次更新 14:32</span>
          </div>
          {state === "error" && (
            <div className="usage-recovery">
              <Alert variant="destructive" className="usage-alert">
                <AlertTitle>暂时无法更新用量</AlertTitle>
                <AlertDescription>
                  请检查网络后重试。上次数据来自 14:32，不能代表当前剩余额度。
                </AlertDescription>
              </Alert>
              <div className="recovery-actions">
                <Button onClick={() => notify("已演示重试动作；网络恢复流程尚未实现。")}>
                  重新连接
                </Button>
                <Button
                  variant="ghost"
                  aria-expanded={showPrevious}
                  onClick={() => setShowPrevious(!showPrevious)}
                >
                  {showPrevious ? "收起旧数据" : "查看上次数据（14:32）"}
                </Button>
              </div>
            </div>
          )}
          {(state !== "error" || showPrevious) && (
            <div className={cn("quota-pair", state === "error" && "previous-data")}>
              <Quota title="5 小时窗口" remaining={72} reset="约 2 小时后恢复" />
              <Quota title="本周窗口" remaining={41} reset="周五 09:00 恢复" />
            </div>
          )}
          <section className="detail-section">
            <div className="section-heading">
              <h2>账号与同步</h2>
              <span>仅显示当前账号的额度</span>
            </div>
            <dl className="detail-list">
              <div>
                <dt>更新方式</dt>
                <dd>每 5 分钟自动更新</dd>
              </div>
              <div>
                <dt>下次检查</dt>
                <dd>14:37</dd>
              </div>
              <div>
                <dt>同步状态</dt>
                <dd>
                  <Status warning={state === "error"}>
                    {state === "error" ? "等待重试" : "已同步"}
                  </Status>
                </dd>
              </div>
            </dl>
          </section>
          {state === "dense" && (
            <section className="detail-section">
              <div className="section-heading">
                <h2>其他账号</h2>
                <span>切换后查看对应余量</span>
              </div>
              <div className="other-account">
                <UserRound aria-hidden="true" />
                <span>团队协作与较长名称的测试工作区账号</span>
                <Button
                  variant="outline"
                  onClick={() => notify("账号切换仅为交互演示，没有读取任何凭据。")}
                >
                  切换查看
                </Button>
              </div>
              <div className="other-account">
                <UserRound aria-hidden="true" />
                <span>临时实验账号</span>
                <Button
                  variant="outline"
                  onClick={() => notify("账号切换仅为交互演示，没有读取任何凭据。")}
                >
                  切换查看
                </Button>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
function Inspector({
  state,
  onModules,
  modules,
}: {
  state: ReviewState;
  onModules(): void;
  modules: ModuleFlags;
}) {
  return (
    <aside className="context-inspector" aria-label="当前上下文">
      <section>
        <h2>当前账号</h2>
        {state === "empty" ? <p>尚未连接</p> : <Account dense={state === "dense"} />}
      </section>
      <section>
        <h2>当前状态</h2>
        <dl className="inspector-list">
          <div>
            <dt>用量更新</dt>
            <dd>
              {!modules.usage
                ? "已停用"
                : state === "empty"
                  ? "等待连接"
                  : state === "error"
                    ? "需要重试"
                    : "正常"}
            </dd>
          </div>
          <div>
            <dt>外观模块</dt>
            <dd>{modules.appearance ? "待连接" : "未启用"}</dd>
          </div>
          <div>
            <dt>账号数据</dt>
            <dd>仅合成示意</dd>
          </div>
        </dl>
      </section>
      <section className="inspector-note">
        <ShieldCheck aria-hidden="true" />
        <p>模块独立运行。一个模块暂时不可用，不影响其他模块。</p>
      </section>
      <Button variant="outline" onClick={onModules}>
        管理模块
        <ArrowUpRight data-icon="inline-end" />
      </Button>
    </aside>
  );
}
function Appearance({ notify }: SurfaceProps) {
  const [selected, setSelected] = useState("paper");
  const presets = [
    { id: "paper", name: "纸白", description: "清晰、轻盈", className: "scene-paper" },
    { id: "ink", name: "墨黑", description: "适合深夜", className: "scene-ink" },
    { id: "mist", name: "雾蓝", description: "安静的冷色", className: "scene-mist" },
  ];
  return (
    <div className="appearance-page">
      <header className="page-heading">
        <div>
          <h1>外观</h1>
          <p>给外部 Codex 选择一套舒服的布景。</p>
        </div>
        <Status warning>尚未连接 Codex</Status>
      </header>
      <div className="appearance-preview" data-preset={selected}>
        <div className="scene-mini-sidebar">
          <span>Codex</span>
          <i />
          <i />
          <i />
        </div>
        <div className="scene-mini-body">
          <div className="scene-line scene-line-short" />
          <div className="scene-line" />
          <div className="scene-line" />
          <div className="scene-compose">在这里开始新的想法</div>
        </div>
      </div>
      <section className="detail-section">
        <h2>选择布景</h2>
        <ToggleGroup
          aria-label="布景方案"
          className="preset-grid"
          value={[selected]}
          variant="outline"
          onValueChange={(values) => {
            const preset = presets.find((item) => item.id === values[0]);
            if (preset) {
              setSelected(preset.id);
              notify(`正在预览「${preset.name}」，不会连接或修改外部 Codex。`);
            }
          }}
        >
          {presets.map((preset) => (
            <ToggleGroupItem key={preset.id} value={preset.id} className="preset-option">
              <span className={cn("preset-swatch", preset.className)} aria-hidden="true" />
              <span className="preset-label">
                <strong>{preset.name}</strong>
                <small>{preset.description}</small>
              </span>
              {selected === preset.id && <Check aria-hidden="true" />}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </section>
      <div className="appearance-actions">
        <p>先连接，再决定是否应用。预览不会改变其他应用。</p>
        <Button onClick={() => notify("连接 Codex 的功能尚未实现，此按钮仅供评审操作位置。")}>
          连接 Codex
          <ArrowUpRight data-icon="inline-end" />
        </Button>
      </div>
    </div>
  );
}
function Modules({
  notify,
  modules,
  onModules,
}: SurfaceProps & { modules: ModuleFlags; onModules(modules: ModuleFlags): void }) {
  const { usage, appearance } = modules;
  return (
    <div>
      <header className="page-heading">
        <div>
          <h1>模块</h1>
          <p>只开启你需要的能力。</p>
        </div>
      </header>
      <div className="module-rows">
        <section className="module-row">
          <Activity aria-hidden="true" />
          <div>
            <h2>用量</h2>
            <p>查看账号余量与恢复时间。</p>
          </div>
          <Button
            variant={usage ? "outline" : "default"}
            onClick={() => {
              onModules({ ...modules, usage: !usage });
              notify("模块启停仅为演示，不会启动后台服务。");
            }}
          >
            {usage ? "停用" : "启用"}
          </Button>
        </section>
        <section className="module-row">
          <Palette aria-hidden="true" />
          <div>
            <h2>外观</h2>
            <p>管理外部 Codex 的布景。</p>
          </div>
          <Button
            variant={appearance ? "outline" : "default"}
            onClick={() => {
              onModules({ ...modules, appearance: !appearance });
              notify("模块启停仅为演示，不会启动后台服务。");
            }}
          >
            {appearance ? "停用" : "启用"}
          </Button>
        </section>
      </div>
      <div className="extension-note">
        <Plus aria-hidden="true" />
        <p>新的能力可以在这里加入，沿用同一套启停、设置与状态。</p>
      </div>
    </div>
  );
}
function Preferences({
  notify,
  glanceItems,
  onGlanceItems,
}: SurfaceProps & { glanceItems: string[]; onGlanceItems(items: string[]): void }) {
  const [mode, setMode] = useState("system");
  return (
    <div>
      <header className="page-heading">
        <div>
          <h1>设置</h1>
          <p>调整 Codex Coco 自身的使用习惯。</p>
        </div>
      </header>
      <FieldGroup>
        <Field>
          <FieldLabel>窗口外观</FieldLabel>
          <ToggleGroup
            aria-label="设置窗口外观示意"
            value={[mode]}
            variant="outline"
            onValueChange={(values) => {
              if (values[0]) {
                setMode(values[0]);
                notify("设置页仅演示控件组合；实际画面请用评审栏的显示模式切换。");
              }
            }}
          >
            <ToggleGroupItem value="light">浅色</ToggleGroupItem>
            <ToggleGroupItem value="dark">深色</ToggleGroupItem>
            <ToggleGroupItem value="system">跟随系统</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>
            这是 Codex Coco 的界面设置，与外部 Codex 布景分别管理。
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel>悬浮窗内容</FieldLabel>
          <ToggleGroup
            multiple
            aria-label="悬浮窗显示模块"
            value={glanceItems}
            variant="outline"
            onValueChange={onGlanceItems}
          >
            <ToggleGroupItem value="usage">用量余量</ToggleGroupItem>
            <ToggleGroupItem value="appearance">当前外观</ToggleGroupItem>
          </ToggleGroup>
          <FieldDescription>悬浮窗汇集各模块的简要信息，完整操作仍在主窗口。</FieldDescription>
        </Field>
        <Field>
          <FieldLabel>菜单栏</FieldLabel>
          <div className="setting-row">
            <span>关闭窗口后继续在菜单栏提供入口</span>
            <Status>已开启</Status>
          </div>
          <FieldDescription>这里只展示未来设置的组织方式，不修改系统偏好。</FieldDescription>
        </Field>
      </FieldGroup>
    </div>
  );
}
function Glance({
  state,
  items,
  modules,
  notify,
  openPage,
}: SurfaceProps & { items: string[]; modules: ModuleFlags; openPage(page: Page): void }) {
  const [open, setOpen] = useState(true);
  const [oldData, setOldData] = useState(false);
  return (
    <section className="floating-scene" aria-label="菜单栏悬浮窗场景">
      <div className="desktop-menubar">
        <span>Codex Coco</span>
        <div>
          <button
            type="button"
            className="menubar-entry"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Activity aria-hidden="true" />
            {!items.includes("usage") || !modules.usage
              ? "速览"
              : state === "error"
                ? "需要处理"
                : state === "empty"
                  ? "未连接"
                  : "余 72%"}
          </button>
          <span>14:32</span>
        </div>
      </div>
      {open && (
        <section className="glance-panel" aria-label="跨模块速览">
          <header className="glance-heading">
            <div>
              <h2>Codex Coco</h2>
              <p>速览</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label="自定义悬浮窗"
              onClick={() => openPage("settings")}
            >
              <SlidersHorizontal />
            </Button>
          </header>
          {items.includes("usage") && (
            <section className="glance-module">
              <div className="glance-section-heading">
                <h3>用量 · 剩余额度</h3>
                <span>个人账号</span>
              </div>
              {!modules.usage ? (
                <div className="glance-recovery">
                  <strong>用量模块已停用</strong>
                  <Button variant="outline" onClick={() => openPage("modules")}>
                    管理模块
                  </Button>
                </div>
              ) : state === "error" ? (
                <div className="glance-recovery">
                  <TriangleAlert aria-hidden="true" />
                  <strong>用量更新失败</strong>
                  <p>请检查网络或重新连接。旧数据不代表当前余量。</p>
                  <Button onClick={() => notify("重试按钮仅演示恢复路径，没有发起真实请求。")}>
                    重新连接
                  </Button>
                  <Button
                    variant="ghost"
                    aria-expanded={oldData}
                    onClick={() => setOldData(!oldData)}
                  >
                    {oldData ? "收起旧数据" : "查看上次数据"}
                  </Button>
                  {oldData && <p>14:32 的旧结果：5 小时窗口剩余 72%，本周剩余 41%。</p>}
                </div>
              ) : state === "empty" ? (
                <div className="glance-empty">
                  <p>连接账号后查看余量与恢复时间。</p>
                  <Button onClick={() => openPage("usage")}>前往连接账号</Button>
                </div>
              ) : (
                <>
                  <div className="glance-quotas">
                    <div>
                      <span>5 小时窗口</span>
                      <strong>
                        72<small>%</small>
                      </strong>
                      <span>约 2 小时后恢复</span>
                    </div>
                    <div>
                      <span>本周窗口</span>
                      <strong>
                        41<small>%</small>
                      </strong>
                      <span>周五 09:00 恢复</span>
                    </div>
                  </div>
                  <div className="glance-module-footer">
                    <span>14:32 更新</span>
                    <Button variant="ghost" onClick={() => openPage("usage")}>
                      打开用量
                      <ArrowUpRight data-icon="inline-end" />
                    </Button>
                  </div>
                </>
              )}
            </section>
          )}
          {items.includes("appearance") && (
            <section className="glance-module">
              <div className="glance-section-heading">
                <h3>外观</h3>
                <span>{modules.appearance ? "待连接" : "未启用"}</span>
              </div>
              <div className="glance-appearance">
                <span className="mini-swatch" aria-hidden="true" />
                <div>
                  <strong>尚未应用布景</strong>
                  <p>在主窗口选择和预览</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="打开外观"
                  onClick={() => openPage("appearance")}
                >
                  <ArrowUpRight />
                </Button>
              </div>
            </section>
          )}
          {!items.length && (
            <div className="glance-empty">
              <p>还没有选择速览内容。</p>
              <Button variant="outline" onClick={() => openPage("settings")}>
                选择显示模块
              </Button>
            </div>
          )}
          <footer className="glance-footer">
            <span>合成数据 · 不读取账号</span>
            <Button variant="ghost" onClick={() => openPage("modules")}>
              打开主窗口
              <ArrowUpRight data-icon="inline-end" />
            </Button>
          </footer>
        </section>
      )}
      <p className="scene-caption">菜单栏入口可开合悬浮窗；各模块只贡献简要信息与跳转。</p>
    </section>
  );
}

const pageViews: Record<"usage" | "appearance", ComponentType<SurfaceProps>> = {
  usage: Usage,
  appearance: Appearance,
};

/** Independent review only: synthetic data, no bridge, persistence, account access or external actions. */
export function DesignReview() {
  const query = new URLSearchParams(window.location.search);
  const initial = query.get("direction");
  const [direction, setDirection] = useState<Direction>(
    initial === "topbar" || initial === "workbench" ? initial : "sidebar",
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [page, setPage] = useState<Page>("appearance");
  const [surface, setSurface] = useState(query.get("surface") === "glance" ? "glance" : "main");
  const [modules, setModules] = useState<ModuleFlags>({ usage: true, appearance: false });
  const [glanceItems, setGlanceItems] = useState(["usage", "appearance"]);
  const [state, setState] = useState<ReviewState>("normal");
  const [dark, setDark] = useState(query.get("theme") === "dark");
  const [colorInput, setColorInput] = useState("#3464dc");
  const [primaryColor, setPrimaryColor] = useState<string | null>("#3464dc");
  const [message, setMessage] = useState("所有账号、额度和状态均为示意，操作不触发真实功能。");
  const selected = directions[direction];
  const View = page === "usage" || page === "appearance" ? pageViews[page] : null;
  return (
    <ThemeProvider
      preference={{ mode: dark ? "dark" : "light", presetId: "neutral", primaryColor }}
    >
      <div className="review-stage">
        <header className="review-header">
          <div>
            <h1>Codex Coco · 窗口方案</h1>
            <p>比较整体结构，再决定正式界面。</p>
          </div>
          <span className="review-marker">设计评审 · 合成数据</span>
        </header>
        <section className="review-controls" aria-label="评审控制">
          <ToggleGroup
            aria-label="窗口方案"
            value={[direction]}
            variant="outline"
            onValueChange={(values) => {
              const value = values[0];
              if (value === "sidebar" || value === "topbar" || value === "workbench") {
                setDirection(value);
                setMessage("已切换布局，页面与示意数据保持一致。");
              }
            }}
          >
            {Object.entries(directions).map(([value, item]) => (
              <ToggleGroupItem key={value} value={value}>
                {item.name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <div className="review-appearance">
            <Button variant="outline" aria-pressed={dark} onClick={() => setDark(!dark)}>
              <Monitor data-icon="inline-start" />
              {dark ? "深色" : "浅色"}
            </Button>
            <label htmlFor="review-primary">主题色</label>
            <Input
              id="review-primary"
              className="review-color"
              value={colorInput}
              aria-invalid={normalizePrimaryColor(colorInput) === null}
              onChange={(event) => {
                setColorInput(event.target.value);
                const color = normalizePrimaryColor(event.target.value);
                if (color) setPrimaryColor(color);
              }}
            />
          </div>
        </section>
        <div className="surface-selector">
          <ToggleGroup
            aria-label="入口场景"
            value={[surface]}
            variant="outline"
            onValueChange={(values) => {
              if (values[0]) setSurface(values[0]);
            }}
          >
            <ToggleGroupItem value="main">主窗口</ToggleGroupItem>
            <ToggleGroupItem value="glance">菜单栏悬浮窗</ToggleGroupItem>
          </ToggleGroup>
          <span>完整能力在主窗口，跨模块信息在悬浮窗速览。</span>
        </div>
        <div className="direction-note">
          <h2>{selected.title}</h2>
          <p>
            {selected.description} {selected.tradeoff}
          </p>
        </div>
        {surface === "main" ? (
          <section
            className={cn(
              "product-window",
              `layout-${direction}`,
              direction === "sidebar" && sidebarCollapsed && "sidebar-collapsed",
            )}
            aria-label={`${selected.name}完整窗口`}
          >
            <header className="window-titlebar">
              <div className="window-controls">
                <div className="traffic-lights" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                {direction === "sidebar" && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="sidebar-toggle"
                    aria-label={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
                    aria-expanded={!sidebarCollapsed}
                    aria-controls="review-navigation"
                    onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                  >
                    {sidebarCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
                  </Button>
                )}
              </div>
              <span className="window-name">Codex Coco</span>
              {direction !== "sidebar" && (
                <span className="window-local">
                  <ShieldCheck aria-hidden="true" />
                  本地运行
                </span>
              )}
            </header>
            <div className="window-layout">
              <aside id="review-navigation" className="navigation-region">
                {direction !== "sidebar" && <div className="navigation-caption">工作空间</div>}
                <Navigation
                  page={page}
                  compact={direction === "sidebar"}
                  onChange={(next) => {
                    setPage(next);
                    setMessage("已切换示意页面，不会读取或修改真实数据。");
                  }}
                />
                {direction !== "sidebar" && (
                  <div className="navigation-footer">
                    <span className="local-dot" />
                    {Object.values(modules).filter(Boolean).length} 个模块已启用
                  </div>
                )}
              </aside>
              <main className="product-content">
                {page === "usage" && !modules.usage ? (
                  <section className="empty-content">
                    <Activity aria-hidden="true" />
                    <h1>用量模块已停用</h1>
                    <p>重新启用后，在这里查看余量与恢复时间。</p>
                    <Button onClick={() => setPage("modules")}>管理模块</Button>
                  </section>
                ) : View ? (
                  <View key={state} state={state} notify={setMessage} />
                ) : page === "modules" ? (
                  <Modules
                    state={state}
                    notify={setMessage}
                    modules={modules}
                    onModules={setModules}
                  />
                ) : (
                  <Preferences
                    state={state}
                    notify={setMessage}
                    glanceItems={glanceItems}
                    onGlanceItems={setGlanceItems}
                  />
                )}
              </main>
              {direction === "workbench" && (
                <Inspector state={state} modules={modules} onModules={() => setPage("modules")} />
              )}
            </div>
            {direction !== "sidebar" && (
              <footer className="window-footer">
                <span>
                  <span className="local-dot" />
                  {state === "error" ? "保留上次结果" : "示意数据"}
                </span>
                <span>不会连接账号或修改外部 Codex</span>
              </footer>
            )}
          </section>
        ) : (
          <Glance
            key={state}
            state={state}
            items={glanceItems}
            modules={modules}
            notify={setMessage}
            openPage={(next) => {
              setPage(next);
              setSurface("main");
            }}
          />
        )}
        <section className="review-states" aria-label="评审状态">
          <span>
            <SlidersHorizontal aria-hidden="true" />
            用量状态
          </span>
          <ToggleGroup
            aria-label="内容状态"
            value={[state]}
            variant="outline"
            onValueChange={(values) => {
              const value = values[0];
              if (
                value === "normal" ||
                value === "empty" ||
                value === "error" ||
                value === "dense"
              ) {
                setState(value);
                setPage("usage");
              }
            }}
          >
            {Object.entries(states).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value}>
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </section>
        <output className="review-feedback" aria-live="polite">
          {message}
        </output>
      </div>
    </ThemeProvider>
  );
}
