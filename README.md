# YTPTube Extension - Cookie Sync

基于 [YTPTube Extension](https://github.com/arabcoders/ytptube) 的修改版本，新增了**浏览器 Cookie 同步到预设**、**下载通知**、**历史记录**等增强功能。

## 原作者致谢

本项目基于 [arabcoders/ytptube](https://github.com/arabcoders/ytptube) 的浏览器扩展进行修改。原项目是一个自托管的 yt-dlp 下载管理器，功能包括：

- 定时任务、预设、条件规则
- 媒体库准备和 NFO 生成
- 多种下载管理功能

原项目采用 MIT 许可证。

## 功能特性

- **Cookie 同步**：把浏览器中的网站 Cookie 以 Netscape 格式写入 YTPTube 预设
- **自动同步 Cookie**：按设定间隔自动为配置的站点同步 Cookie
- **按网站自动选择预设**：打开弹窗时根据当前网站自动选中匹配的预设
- **下载通知**：下载完成/失败时发送浏览器通知，支持失败重试和工具栏角标
- **历史记录页面**：搜索、筛选、分页、归档、删除、重试
- **批量添加**：一次提交多个 URL
- **预设管理**：创建、删除预设，导入/导出 Cookie
- **快捷键**：`Alt+Shift+S` 将当前标签页发送到 YTPTube

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

- **同步 Cookie**：读取当前页面 URL 对应的所有 Cookie，转换为 Netscape 格式，通过 `PATCH /api/presets/{id}` 更新到目标预设
- **预览**：预览当前页面 Cookie 转换后的 Netscape 格式内容
- **复制**：将预览内容复制到剪贴板

### 技术实现

- 新增 `cookies` 权限，使用 `chrome.cookies.getAll({ url })` 读取当前 URL 的 Cookie
- 使用可选主机权限 `optional_host_permissions`（`http://*/*`、`https://*/*`），按需在运行时请求，无需预授权所有站点
- 使用 `toNetscapeFormat()` 生成 Netscape 格式，`parseNetscape()` 可解析已有的 Cookie 文件
- 使用 `PATCH /api/presets/{id}` API 将 Cookie 写入预设

## 新增功能：自动同步 Cookie

在 **选项 → 自动 Cookie 同步** 中启用后，扩展会按设定的间隔（默认 360 分钟，最小 5 分钟）自动为配置的站点同步 Cookie：

- 每个目标由「预设 + 站点 URL」组成，添加时会请求该站点的可选权限
- 使用 `chrome.alarms` 定时触发，后台无页面时也可运行
- 未授权的目标会标记为「已跳过」，结果汇总显示在选项页
- 可选择是否让同步在后台静默进行

## 新增功能：下载通知与实时状态

弹窗底部提供**实时下载状态**区域：

- **进行中的下载**：通过 YTPTube 的实时接口（WebSocket，失败时回退轮询）显示队列进度、速度与剩余时间
- **失败的下载**：可按 Failed / All / Skipped / Cancelled 筛选，支持单项或**全部重试**

浏览器通知（可在选项中开关）：

- 下载完成时通知
- 下载失败时通知，并可直接在通知中点击**重试**
- 工具栏角标显示当前活动/失败数量

## 新增功能：历史记录页面

点击弹窗中的 **History** 按钮打开独立的历史记录页面，支持：

- 按标题或 URL 搜索
- 按状态筛选（完成 / 失败 / 错误 / 跳过 / 取消）
- 分页浏览
- 归档 / 取消归档、删除、重试

## 新增功能：批量添加与预设管理

- **批量添加**：在弹窗中展开 **Batch add**，每行一个 URL，一次性提交
- **预设管理**：在选项页创建或删除预设；对已有预设可**导出** Cookie 为文件，或**导入** Cookie 文件

## 其他改进

- **快捷键**：`Alt+Shift+S` 发送当前标签页（可在浏览器扩展快捷键设置中修改）
- **认证存储**：认证信息改为存储在 `local` storage，并自动从旧的 `sync` storage 迁移
- **共享 API 模块**：新增 `src/api.js`，统一处理实例地址、认证头和超时请求

### 安装方式

1. 打开 `chrome://extensions/`
2. 开启**开发者模式**
3. 点击**加载已解压的扩展程序**
4. 选择 `src` 目录

### 构建

运行 `./builder.sh` 会在项目根目录生成 `ytptube-extension.zip`（需安装 `zip` 命令）。

### 修改的文件

| 文件 | 说明 |
|------|------|
| `src/manifest.json` | 版本 1.7.0；添加 `cookies`、`alarms`、`clipboardWrite` 权限、可选主机权限、快捷键命令 |
| `src/api.js` | **新增** 共享 YTPTube API 请求模块（地址、认证、超时） |
| `src/auth.js` | 认证改存 `local` storage，支持从 `sync` 迁移及清除 |
| `src/cookies.js` | **新增** 按 URL 读取 Cookie、Netscape 格式转换与解析 |
| `src/background.js` | 通知、实时状态轮询、失败重试、自动同步定时器、快捷键处理 |
| `src/history.html` / `src/history.js` | **新增** 历史记录页面 |
| `src/popup.html` | 添加 Cookie 同步、实时/失败下载、批量添加、历史、跳转后台等 UI |
| `src/popup.js` | Cookie 同步/复制、实时状态、失败重试、批量添加、按域名自动选择预设 `inferPresetByUrl()` |
| `src/options.html` | 添加通知、自动同步、预设管理区域 |
| `src/options.js` | 通知/自动同步设置、预设创建删除、Cookie 导入导出、可选权限请求 |
| `src/css/popup.css` / `src/css/ytp.css` | 新增区域的样式 |
| `src/fanart.js` | 背景相关调整 |
| `src/_locales/*/messages.json` | 新增各语言的翻译文案 |

## 许可证

MIT License - 原作者 [arabcoders](https://github.com/arabcoders)