# 应用更新

Codex Coco 从固定的公开仓库 [cixiangtao/codex-coco](https://github.com/cixiangtao/codex-coco/releases) 检测正式版本。更新属于应用宿主，生命周期持续到退出，不挂在业务模块下。用量工具的 Codex CLI 升级是另一项明确操作，两者互不触发。

## 检测与手动下载

- 默认手动检查，启动不联网。可保存 4–168 小时的后台检查间隔；0 关闭定时检查。检查不会自动下载或安装。
- 使用匿名 GitHub REST `releases/latest`，固定 HTTPS 地址，不读取 GitHub 凭据，不发送账号内容，禁止重定向；请求超时 15 秒，响应最多 1 MiB。
- 只接受非草稿、非预发布的正式 Release，标签为 `X.Y.Z` 或 `vX.Y.Z`。按数字比较版本，同版本号的正式版高于当前开发预发布版，不降级。当前只支持稳定频道，不把 beta Release 当作正式更新。
- HTTP 404 表示尚无正式版本；不显示“已是最新版”。网络、限流、解析失败单独显示检查失败，并清除上次可下载版本。
- 检测不要求应用签名，也不依赖 Release 中已经存在更新器元数据。开发版和未签名本地包均可检查并打开发布页面，手动下载可用附件。
- 主窗口可打开固定仓库的 Releases 页面或本次检测的版本页；链接从受限标签构造，不使用响应的任意 `html_url`，IPC 不接受外部 URL。打开系统浏览器仅由明确点击触发。

GitHub 的 [Release API 文档](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) 是检测协议来源；仅公开版本、状态、检查时间和受限发布页 URL，不公开发布正文、作者信息、原始错误或路径。

## 应用内下载与安装

原生更新仍使用按需加载的 electron-updater 6.8.9 和 GitHub provider，固定相同 owner/repo。界面和后台都拒绝未签名应用自替换；自签名发行版使用仓库固定证书和 bundle identifier 校验，不能用任意自签名代替。签名版的下载与安装分别需要明确确认。

1. 检测到新版后确认下载。更新引擎重新读取 GitHub provider 的元数据，核对版本仍与用户确认的版本一致；变化或缺失时失败，要求重新检查，不下载另一版本。
2. 由更新引擎执行 SHA-512 校验并公开进度。取消等待底层任务实际结束；provider 元数据请求期间取消需等待该请求结束，再阻止文件下载。
3. 下载后再次确认安装并重启。原生 Squirrel.Mac 验证更新包签名并替换；普通退出不会自动安装。未签名本地包不执行此步骤。

正式更新 Release 需要 electron-builder 生成的 `latest-mac.yml` 和对应架构的签名 ZIP，版本必须匹配 Release 标签。DMG 可供首次手动安装，单独上传源码归档或 DMG 不构成原生自动更新链路。参见 [electron-builder 更新说明](https://www.electron.build/docs/features/auto-update/)。

仓库已配置 GitHub 发布目标，但 `pnpm run pack` 仍使用 `--dir --publish never`，只生成本地未签名应用目录。免费自签名预览发行的准备与验证入口见 [发行说明](releases.md)。自签名不等于 Apple Developer ID 或公证。尚无公开发行附件，真实更新验收完成后再通过 GitHub Actions 发布预览。

## 配置、权限与隐私

`updates.json` 当前为版本 2，仅保存后台检查间隔与 revision，不允许界面设置任意更新源。版本 1 的合法自定义源配置在读取时移除源并停用定时检查，原文件保留到下一次明确保存或备份重置；不静默改连新服务。损坏和未知版本的配置不被覆盖。保存采用 revision 冲突检查和原子写入；重置先保留原文件备份。

下载或安装时不能改偏好。更新包缓存由更新引擎管理，安装识别 UUID 使用共享固定请求头覆盖，不发送安装唯一标识。主窗口可读写，速览连更新设置读取和打开发布页面都不开放。诊断排除远端响应、发布正文、账号、私有路径和原始异常。

## 验证边界

- 合同测试覆盖稳定版本比较、草稿与预发布拒绝、固定匿名 API、有界响应、HTTP 失败、取消、未签名可检查/不可下载、下载与安装确认、配置迁移、定时 opt-in、冲突、损坏备份及私有错误排除。
- `pnpm run verify:updates` 使用真实 Electron 生产入口、临时配置及受控 `net.fetch`，验证无版本、新版、失败恢复、取消、打开受限发布页、多窗口、重启和速览权限。`node scripts/verify-updates.mjs --packaged` 验证同一未签名本地包。
- 受控传输不请求真实 GitHub，不打开系统浏览器，不执行真实安装。真实签名 ZIP 的下载、系统签名验证、替换与重启仍需未来正式发行验收；源码仓库或本地构建通过不代表这些已经交付。
