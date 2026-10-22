---
name: Codex Coco
description: 柔彩仪表台，以紧凑的圆润表面呈现真实状态和明确操作。
colors:
  primary: "var(--primary)"
  primary-foreground: "var(--primary-foreground)"
  background: "var(--background)"
  foreground: "var(--foreground)"
  card: "var(--card)"
  muted: "var(--muted)"
  muted-foreground: "var(--muted-foreground)"
  border: "var(--border)"
  input: "var(--input)"
  destructive: "var(--destructive)"
  data-primary: "var(--data-primary)"
  data-success: "var(--data-success)"
  data-warning: "var(--data-warning)"
  data-primary-surface: "var(--data-primary-surface)"
  data-success-surface: "var(--data-success-surface)"
  data-warning-surface: "var(--data-warning-surface)"
typography:
  title:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.025em"
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", sans-serif'
    fontSize: "14px"
    lineHeight: 1.6
  label:
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.5
  instrument:
    fontSize: "25px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-0.035em"
  metadata:
    fontSize: "10px"
    lineHeight: 1.5
  caption:
    fontSize: "11px"
    lineHeight: 1.5
  description:
    fontSize: "12px"
  section:
    fontSize: "15px"
    fontWeight: 550
  input-base:
    fontSize: "16px"
  summary:
    fontSize: "18px"
    fontWeight: 600
    lineHeight: 1.4
  instrument-small:
    fontSize: "21px"
  instrument-compact:
    fontSize: "23px"
  settings-label:
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.5
  settings-legend:
    fontSize: "12px"
    fontWeight: 550
rounded:
  sm: "6px"
  md: "8px"
  lg: "10px"
  xl: "16px"
  card: "18px"
  control: "10px"
  tabs: "12px"
  segment: "7px"
  plot: "5px"
  pill: "999px"
  circle: "50%"
spacing:
  unit: "4px"
  small: "8px"
  compact: "12px"
  regular: "16px"
  inset: "18px"
  section: "24px"
  page: "28px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.control}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "var(--primary-hover)"
  button-outline:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.control}"
    height: "32px"
  input:
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "32px"
    padding: "4px 10px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.card}"
    padding: "{spacing.inset}"
  card-compact:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "{spacing.compact}"
  progress-ring:
    textColor: "{colors.data-primary}"
    size: "112px"
  progress-ring-small:
    size: "92px"
  tabs-list:
    backgroundColor: "{colors.muted}"
    rounded: "{rounded.tabs}"
    padding: "4px"
  settings-group:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.card}"
    padding: "0 16px"
  settings-row:
    padding: "14px 0"
  switch:
    backgroundColor: "{colors.input}"
    rounded: "{rounded.pill}"
    width: "42px"
    height: "26px"
    padding: "3px"
  switch-checked:
    backgroundColor: "{colors.data-primary}"
  switch-thumb:
    backgroundColor: "{colors.card}"
    rounded: "{rounded.circle}"
    size: "20px"
---

# Design System: Codex Coco

## Overview

**Creative North Star: "柔彩仪表台"**

Codex Coco 用安静的中性外壳承托柔彩数据表面，以圆环、圆润卡片和紧凑分组建立清楚的操作层级。颜色帮助辨认真实状态，文字说明来源、时间与恢复路径；界面保持桌面工具应有的准确和克制。

用户已选择 A 柔彩仪表台方向，并明确要求保留圆环、圆润圆角、进一步压紧布局和先封装组件。本规范将该方向记录为新的视觉基线；当前覆盖用量页面、菜单栏速览、外观布景工作台，以及窗口主题、应用更新、系统与菜单栏等已接入的分组设置表单。设置行沿用用户明确指定的 iOS Field Group 组织方式：圆润列表、组外说明和组内细分隔，与柔彩仪表共用现有主题身份。具体页面策略见 [用量与速览 surface brief](docs/surfaces/usage-and-glance.md)、[外观 surface brief](docs/surfaces/appearance.md) 和 [设置 surface brief](docs/surfaces/settings.md)，批准参考见 [样稿](docs/design/instruments-approved.png) 与 [批准记录](docs/design/instruments-approved.json)。样稿中的示例账号、数值、色板和冗余进度条不进入运行时。

**Key Characteristics:**

- 中性外壳、柔彩数据、圆润而紧凑的表面。
- 系统字体与等宽数字，主次信息一眼可分。
- 共享组件先行，主题和状态由语义合同驱动。
- 真实值、未知值、失败与历史记录有明确差别。

## Colors

前置 token 引用运行时 CSS 变量，取值以 `packages/ui/src/theme/resolve.ts` 为准；`packages/ui/src/styles/globals.css` 提供初始回退。支持浅色、深色、跟随系统、预设和自定义主色，不把样稿的固定浅色值复制到业务组件。

### Primary

- **交互墨色 / 主题主色**（`primary`）：主要按钮、选中入口与必要强调。中性预设使用墨色，蓝色、紫色和自定义主色由主题解析；前景、悬停、按下和焦点色一同生成。
- **柔紫仪表色**（`data-primary` / `data-primary-surface`）：额度与主要数据的彩色弧和淡色底面。中性预设提供柔紫身份；其他预设跟随主色，自定义颜色经过对比度修正。

### Secondary

- **薄荷绿**（`data-success` / `data-success-surface`）：并列额度、最新柱形及第二组数据的辨识色。它与业务成功提示的 `success` token 分开，不能只凭绿色推断业务成功。

### Tertiary

- **柔金色**（`data-warning` / `data-warning-surface`）：第三组数据与辅助数据强调。业务警告仍由实际状态与文字共同表达，不把每个金色数字解释为告警。

### Neutral

- **外壳灰**（`muted`）：标题栏、固定侧栏、标签页轨道与菜单栏外壳。
- **浅底 / 深底**（`background`）：主内容区底面；**卡片表面**（`card`）承载功能分组，随明暗主题变化。
- **正文墨色**（`foreground`）与**次级灰字**（`muted-foreground`）：区分主要读数、描述、来源与时间，不用降低透明度替代所有语义。
- **轻分隔**（`border`）与**输入轮廓**（`input`）：用于真正需要分隔或识别的边界；失败使用 `destructive`，并配合可读原因。

**The Theme-Owned Color Rule.** 主色、数据色和数据底面统一由主题解析器生成；数据底面按模式混合卡片色，页面和弹层通过共享语义变量消费。

## Typography

**Body Font:** 系统 sans 字体，优先 macOS 系统字体，并提供 Segoe UI 与苹方回退。不加载额外品牌字体。

**Character:** 中文标签清楚紧凑，标题适度加重。数字使用 `tabular-nums`，百分比和计数保持稳定对齐；单位、时间和来源退后一级。

### Hierarchy

- **Title**：前置 `title` 用于普通页面标题；主窗口用量页保留可见标题，局部压缩为（23px）。菜单栏监视表面以公开账号标签作为可见身份标题，套餐和跳转入口收在同一身份条。
- **Body**：前置 `body` 为基础正文；页面说明通常（13px），卡片说明（12px）。
- **Label**：前置 `label` 用于卡片标题；设置行使用 `settings-label`，组外 legend 使用 `settings-legend`。页面分区标题（15px / 550），标题栏名称（12px / 550）。
- **Instrument**：前置 `instrument` 用于默认圆环读数；小圆环使用 `instrument-small`，窄窗口额度环使用 `instrument-compact`，速览计数使用 `summary`。
- **Metadata**：主窗口来源和更新时间使用 `caption`，速览来源、时间及单位使用 `metadata`；说明采用 `description`，设置分区采用 `section`，输入框在较小断点使用 `input-base`，均保持可读对比。

## Layout

主窗口使用固定图标侧栏（56px）和原生标题栏（52px），两者共用 `muted` 背景。macOS 窗口按钮由系统提供，HTML 不模拟红绿灯；标题栏拖动区域与按钮交互分离。侧栏常用入口在上，模块管理、设置在下，不增加展开按钮或重复的常驻说明。

内容表面上接标题栏、左接侧栏，右侧和底部留（8px）外壳间距，使用 `background`；四角沿用卡片圆角。内容内距为（22px 28px 28px），最大正文宽度（860px）。仅内容区滚动，侧栏保持可达。窗口默认（980×800），最小（720×640）；宽度不超过（800px）时内距调整为（24px）。

间距以基础单位为底，常用小、紧凑、常规与分区级间距；柔彩组件允许独立的仪表内距与两列间距，避免机械拉大空白。主窗口用量页头保留标题、刷新动作和贴近动作的读取状态，账号与套餐归入订阅额度区。额度以圆环为主、已用比例为短标识，恢复信息同时呈现相对时间与准确时间；今日、7 天、30 天计数与每日柱图归入同一活动表面，计数与单位按基线同行。紧凑双列额度、活动表面与三组标签页属于该 surface 的信息组织，不要求其他模块复制相同组成。

外观布景工作台默认将比例预览与当前图层参数并排，参数列宽（292px），列间距（16px）；宽度不超过（900px）时改为上下排列，图库同时由四列缩为三列。底部保存栏粘附于内容滚动区，使用内容底色与顶部分隔线，动作可换行，任务状态保持可见；其底部偏移随主内容内距在（−28px / −24px）之间适配。这是外观页的编辑布局，不改变其他模块的布局合同。

菜单栏速览上限（360×520），按屏幕可用工作区收缩。外壳内距（14px），模块间距（8px），正文独立滚动，底部“打开主窗口”始终可达。同一紧凑监视表面承载公开账号与套餐身份条、分组额度、恢复时间、本机计数及新鲜度；额度为两列，身份图标容器（32px），分组间距（12px）。统计区统一标注 tokens，重置卡等非 tokens 指标另列；核心仪表使用紧凑数字保持单行，普通模块的长统计值允许换行。其他模块合并为一组带细分隔的紧凑列表，普通停用模块仅保留一行；错误独立突出并先于普通摘要，不把完整设置页面塞进速览。

## Elevation & Depth

深度由中性外壳、内容底面和柔彩卡片的色阶建立。Card 默认使用很轻的环境阴影（`--shadow-card`）；用量额度卡与速览监视表面明确去掉阴影，避免两列数据互相争夺注意。SettingsGroup 默认以底色与细分隔分组，主设置页的分组表面复用卡片轻阴影。主内容容器不加额外边框或阴影，字段、分隔线和 Tooltip 按各自组件语义处理。

### Shadow Vocabulary

- **卡片轻托起**：`0 2px 12px color-mix(in srgb, var(--foreground) 4%, transparent)`，用于默认 Card。
- **选中页签**：`0 1px 3px color-mix(in srgb, var(--foreground) 8%, transparent)`，仅帮助识别浮在灰轨道上的当前页签。
- **开关滑块**：`0 1px 3px color-mix(in srgb, var(--foreground) 18%, transparent)`，帮助识别轨道内的独立滑块。

## Shapes

卡片与主内容轮廓采用 `rounded.card`，默认按钮采用 `rounded.control`，小按钮、输入框和 Tooltip 继续使用共享的小圆角阶梯。标签页轨道采用 `rounded.tabs`，触发器圆角（9px）；Badge 与用量范围选择分段使用 `rounded.segment`，形态紧凑。每日图表柱形仅顶部两角采用 `rounded.plot`，底部与基线平齐；该值不替代卡片或控件的圆角。

圆环是数据几何：端点圆润，圆弧与淡色底轨保持一致中心。它只表达真实百分比，不承担装饰性旋转或无依据的评分。不同尺寸共享同一组件，避免每个页面重新手写弧线。

## Components

通用组件、语义 token 与根主题 Provider 位于 `packages/ui`。应用窗口与导航位于 `apps/desktop/src/renderer/shell`；用量业务组合位于 `apps/desktop/src/modules/usage/renderer`，外观的编辑、图库与连接组合位于 `apps/desktop/src/modules/appearance/renderer`；速览消费公开投影。UI 包不依赖 Electron、IPC、应用配置或业务后台。

### Buttons

主要按钮紧凑明确，默认高度和内距见前置 token。`outline` 负责次要边界操作，`secondary` 使用中性底面，`ghost` 用于导航与轻量操作，`link` 用于文本链接，`destructive` 配合破坏性动作。默认尺寸以外提供（24/28/36px）高度和对应图标按钮。

悬停、按下、键盘焦点、禁用和无效状态由共享变体提供。焦点使用可见主题环；禁用降低不透明度并停止交互。按钮图标通常（16px），只含图标的按钮必须保留可访问名称。

### Cards / Containers

Card 是有功能含义的表面：圆角、底色、轻阴影、标题、说明、内容和操作统一组合。默认内距采用 `spacing.inset`、内部间距（12px）；`density="compact"` 采用 `spacing.compact`、内部间距（8px）。`neutral / primary / success / warning` tone 通过数据 token 提供色彩，不承载业务成功或失败判断。

Box 只负责 `stack / row / grid` 排列、间距与可选内距，默认无底色、圆角和阴影。复用布局用 Box，新增功能表面用 Card，不为每个小段落继续嵌套卡片。

### Inputs / Fields

输入框透明底、单层轮廓和共享中等圆角，高度见前置 token；焦点使用主题环，无效状态使用错误轮廓和文字，禁用有明确视觉反馈。Label、描述与错误信息保持关联，不用 placeholder 替代标签。

### Settings Groups / Rows / Switches

SettingsGroup 提供原生 `fieldset` 分组，公开 `data-slot="settings-group"`；标题用组外 `legend`，辅助说明在表面下方。圆角组体使用 `card` 底色与前置 token 的左右内距，组标题内距（0 14px 8px），组尾说明外距（8px 14px 0）。它只持有分组表面和语义，不负责保存或系统副作用。

SettingsRow 继续复用 Field，公开 `data-slot="settings-row"` 和 `data-layout="inline|stacked"`，保留 FieldLabel / FieldDescription 与控件的关联。默认最小行高（64px），垂直内距见前置 token；左侧标签与说明、右侧简单控件跨两行居中，列间距（24px），行间距（4px），组内（1px）分隔线末行取消。数字输入宽（100px）且右对齐，普通范围输入宽（180px）；复杂内容通过 stacked 在下方展开，stacked 范围输入占满宽度。

宽度不超过（800px）时列间距收为（12px），分段选择和明确的 text/url/无 type 文本输入可以改成上下排列；Switch 保留右列，在（720px）窗口仍右对齐。隐藏 checkbox 不按文本输入处理。外观参数区局部行高（56px）、组体左右内距（14px），不改变其他设置行默认值。

Switch 的公开 slot 为 `switch`，尺寸与滑块见前置 token；关闭使用 `input` 轨道，选中使用 `data-primary`，滑块使用 `card`。`data-checked` 使滑块水平位移（16px），共享（220ms）过渡并尊重减少动态偏好；`:focus-visible` 使用（2px）主题焦点环与（3px）外偏移，`data-disabled` 降至（0.45）不透明度并停止可操作提示。二选一用 Switch，多选项保留分段选择，不将所有行都做成按钮组。

当前分组列表接入窗口主题、应用更新、系统与菜单栏、用量偏好、外观连接及图层参数。分组与开关继续服从宿主草稿、保存、取消、冲突及权限边界；切换偏好不直接修改系统登录项、共享文件、外部布景或应用安装，原有需确认操作仍单独确认。

### Badges

Badge 为短状态或类别提供紧凑淡色底，内距（3px 8px）、字号（11px / 550）。颜色来自 tone，正文仍用可读的语义前景。长错误应使用带恢复路径的提示，不挤进 Badge。

### Navigation / Tabs

固定图标导航保留可访问名称、当前页标记与键盘入口；悬停（300ms）或键盘聚焦显示右侧 Tooltip，Esc 或点击入口关闭，不叠加原生 `title`。设置图标上的小点表示存在未保存的主题预览。

Tabs 使用淡灰轨道与清晰的当前页签，支持键盘操作、窄窗口换行，并保持面板挂载以保存草稿。用量当前标签为“总览 / 辅助工具 / 用量设置”，外观为“布景编辑 / 图片与预设 / 连接设置”。用量切换不触发读取、推理或更新；外观切换不触发连接、启动或应用。主题偏好只同步已保存值，冲突时保留本地草稿与取消入口。

### ProgressRing

默认与小尺寸见前置 token；用量页在窄窗口局部缩为（96px），不修改全系统默认。SVG 负责弧线，原生、视觉隐藏的 `meter` 承载已知数值的可访问语义；真实零值保留数值语义，`null` 或非有限值显示“—”且不输出 `meter`，不能伪装成零。

当前值变化时弧线过渡（450ms）；共享状态过渡（220ms）使用 `cubic-bezier(0.16, 1, 0.3, 1)`。历史记录设置 `animated={false}`；减少动态偏好禁用非必要过渡。速览开合仅短暂淡入与（5px）位移，不添加常驻装饰动画。

### Appearance Workspace

外观工作台复用 Card、Box、Badge、Tabs、Button 和 Field，将布景编辑、图片与预设、连接设置分别组织；预览、图层参数、图库和连接面板属于外观模块，业务组合不移入 UI 包。页面持有壁纸、主面板和侧栏三层草稿，图层选择联动预览定位区域、参数面板与图库目标；切换图层或标签页保留其他图层的修改。

比例预览沿用（1000×620）逻辑几何、共享定位函数与区域拖动换算，图像尺寸、模糊和层级同比缩放；提供方向键与对应滑杆定位，不将三层关系改造成独立示意卡。图片只使用既有图库缩略图及受控本地导入，保留真实比例与来源许可；Codex Coco 主色只影响自己的控件。

粘附保存栏区分“保存并应用布景”“仅保存配置”与“放弃修改”。放弃修改只回到已保存配置，不修改目标窗口；保存与应用保持分离。错误、版本冲突和任务反馈在各标签页之外可见，重启目标仍须明确确认。操作边界不因视觉迁移变化。

### Data / Recovery

速览的相对恢复时间和新鲜度由仅显示用途的时钟更新：窗口可见时每（30 秒）更新显示，隐藏时清理计时器，再显示时立即校准。该时钟不触发模块读取或网络请求。主窗口用量在有当前记录时以同一显示间隔更新文案；源读取仍由明确操作或已保存定时策略控制。到达恢复时间只显示“等待刷新确认”，不能据时钟确认额度已恢复；超过（10 分钟）或已到恢复时间的速览记录提示刷新确认。

用量图形读取校验后的真实合同；缺失值、真实零值、缓存来源及范围完整性明确区分。失败先显示原因和恢复入口，旧记录默认折叠并标为历史，菜单栏不将旧数据作为当前额度。计数保留 tokens 单位，每日图表提供可展开明细。

未接入能力显示真实空状态，配置异常的恢复入口跨页面可达。菜单栏只读，只同步已保存主题并展示公开摘要；写入、应用、兑换与其他业务动作留在主窗口。Codex Coco 自身主题与外部 Codex 布景分别管理。

## Do's and Don'ts

### Do:

- **Do** 先复用 Card、Box、Tabs、Badge、ProgressRing 和分组设置组件，再组合业务页面。
- **Do** 通过主题语义 token 同时适配浅色、深色和极端自定义主色。
- **Do** 使用等宽数字、真实单位、来源与恢复时间帮助判断状态。
- **Do** 保留键盘焦点、图标名称、未知值语义和减少动态偏好。
- **Do** 在默认窗口、最小窗口和菜单栏真实尺寸下检查密度、滚动与底部入口。

### Don't:

- **Don't** 把批准样稿的示例账号、读数、色板或固定浅色色值复制到运行时。
- **Don't** 用零代替未知值，用当前额度样式冒充历史记录，或让历史圆环播放更新动画。
- **Don't** 在 Box 中建立第二套表面、圆角和阴影规范。
- **Don't** 将用量页的双仪表与三组页签强制套用到其他模块。
- **Don't** 将显示时钟、分组容器或偏好开关变成源读取与系统副作用的隐式入口。
