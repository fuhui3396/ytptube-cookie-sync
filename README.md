# YTPTube Extension - Cookie Sync

基于 [YTPTube Extension](https://github.com/arabcoders/ytptube) 的修改版本，新增了**浏览器 Cookie 同步到预设**的功能。

## 原作者致谢

本项目基于 [arabcoders/ytptube](https://github.com/arabcoders/ytptube) 的浏览器扩展进行修改。原项目是一个自托管的 yt-dlp 下载管理器，功能包括：

- 定时任务、预设、条件规则
- 媒体库准备和 NFO 生成
- 多种下载管理功能

原项目采用 MIT 许可证。

## 新增功能：按网站自动选择预设

### 功能说明

浏览器处于某一网站时（如 youtube.com），点击扩展图标打开弹窗，**预设**和 **Cookie 预设**会自动选中与该网站对应的预设；在 bilibili.com 时则自动选中 bilibili 对应的预设，无需手动切换。

### 匹配规则

预设名称与当前页面域名关键字进行匹配，优先级从高到低：

1. 预设名称与域名精确一致（如预设名 `youtube` ↔ `www.youtube.com`）
2. 预设名称包含域名关键字（如预设名 `youtube-music` ↔ `youtube.com`）
3. 域名关键字包含预设名称（如预设名 `yt` ↔ `youtube.com`）

匹配时自动忽略常见子域前缀（`www`、`m`、`mobile` 等）。未匹配到任何预设时，保留用户上次手动选择的值。

### 使用建议

- 预设名称建议使用站点的域名关键字（如 `bilibili`、`youtube`、`twitter`），即可获得精确匹配
- 如果在页面中改变了 URL，推断逻辑仅基于弹窗打开时的当前页面

## 新增功能：Cookie 同步

### 功能说明

将当前浏览器中指定网站的 Cookie 读取并同步到 YTPTube 实例的自定义预设中，格式为 yt-dlp 要求的 **Netscape HTTP Cookie File** 格式。

### 使用方法

1. 在浏览器中登录目标网站（如 bilibili.com）
2. 点击扩展图标，打开弹窗
3. 在 **Cookie 预设** 下拉框中选择一个**自定义预设**（默认预设不可修改）
4. 点击 **同步 Cookie** 按钮
5. Cookie 会通过 API 写入到该预设中
6. 下载时选择该预设即可使用 Cookie 进行认证下载

### 功能按钮

- **同步 Cookie**：读取当前页面域名的所有 Cookie，转换为 Netscape 格式，通过 `PATCH /api/presets/{id}` 更新到目标预设
- **预览**：预览当前页面 Cookie 转换后的 Netscape 格式内容

### 技术实现

- 新增 `cookies` 权限，使用 `chrome.cookies.getAll()` 读取浏览器 Cookie
- 新增 `host_permissions: ["<all_urls>"]` 确保可读取所有域名的 Cookie
- 通过 `domainMatches()` 函数匹配父域名（如 `.bilibili.com`）和子域名（如 `www.bilibili.com`）
- 使用 `PATCH /api/presets/{id}` API 将 Cookie 写入预设

### 安装方式

1. 打开 `chrome://extensions/`
2. 开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择 `src` 目录

### 修改的文件

| 文件 | 说明 |
|------|------|
| `src/manifest.json` | 添加 `cookies` 权限和 `host_permissions` |
| `src/cookies.js` | **新增** Cookie 读取与 Netscape 格式转换模块 |
| `src/background.js` | 添加 `sync-cookies-to-preset` 和 `get-cookies-for-url` 消息处理器 |
| `src/popup.html` | 添加 Cookie 同步区域 UI |
| `src/popup.js` | 添加 Cookie 预设渲染、同步和预览逻辑，以及按网站域名自动选择预设的 `inferPresetByUrl()` |
| `src/css/popup.css` | 添加 Cookie 预览区域样式 |
| `src/_locales/en/messages.json` | 添加英文翻译 |
| `src/_locales/zh_CN/messages.json` | 添加中文翻译 |

## 许可证

MIT License - 原作者 [arabcoders](https://github.com/arabcoders)
