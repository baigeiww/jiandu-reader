<div align="center">

<img src="public/jiandu.svg" width="84" height="84" alt="笺读图标" />

# 笺读

**在 Mac 上安静地读懂一篇论文。**

保留原文结构 · 逐段双语对照 · 公式解释 · 本机论文库

[下载安装](https://github.com/baigeiww/jiandu-reader/releases/latest) · [本版更新](docs/releases/v0.4.1.md) · [反馈问题](https://github.com/baigeiww/jiandu-reader/issues)

</div>

笺读是一款面向英文论文阅读的 Mac 桌面应用。导入 arXiv、Nature、PMC 或 Frontiers 的公开全文，在原文、双语和译文之间切换。正文、公式、图表和引用尽量沿用来源论文的结构，译文按段落保存，方便下次接着读。

当前主分支是 **v0.4.1 Mac 原生版**，使用 AppKit 窗口和 macOS 系统 WebKit。应用内置本机服务及运行环境，安装后直接启动。

## v0.4.1 更新

- 切换论文时保留当前侧栏视图，在「我的藏书」中选论文不会再自动跳到「论文目录」。
- 右上角「＋」支持再次点击收起导入栏，也可用关闭按钮或 Esc，收起后保留尚未提交的网址。
- 新增 Frontiers 公开全文支持，从官方 XML 还原公式、表格、图注及引用，并保留章节导航和翻译功能。

## 安装与首次使用

**系统要求**　Apple Silicon Mac（M1 及更新芯片），macOS 13 或更新系统。当前安装包为 arm64，尚未提供 Intel 安装包。

1. 在 [Releases](https://github.com/baigeiww/jiandu-reader/releases/latest) 下载 `Jiandu-0.4.1-macOS-arm64.dmg`。
2. 打开 DMG，将「笺读」拖入「Applications」，推出磁盘映像，再从「应用程序」启动。
3. 导入论文 HTML 链接或 arXiv 编号，也可以先打开内置示例。
4. 需要 AI 翻译时，打开「翻译设置」，填写自己的服务地址、模型和 API Key，测试连接后保存。

此版本采用本机临时签名，尚未通过 Apple 公证。若首次启动被 macOS 阻止，先尝试打开一次，再到「系统设置 → 隐私与安全性」核对来源，选择「仍要打开」。[Apple 的打开说明](https://support.apple.com/zh-cn/102445)

发布页同时提供 `SHA256SUMS.txt`。在下载目录可用下面的命令核对安装包。

```sh
shasum -a 256 -c SHA256SUMS.txt
```

## 可以做什么

| 阅读时需要 | 笺读提供 |
| --- | --- |
| 对照原文 | 原文、双语、译文三种视图，按段翻译、选区翻译、正文和图注翻译 |
| 理解公式 | 点选公式，查看符号及当前上下文中的模型解释 |
| 看清论文图片 | 宽图、多子图和竖图随阅读区域缩放，点图查看完整图片，Esc 返回 |
| 整理阅读资料 | 本机收藏、分组、版本归并、已译段数及数据导入导出 |
| 舒适阅读 | 暖色浅色界面、深色模式、字号调整、可收起和调宽的侧栏 |
| 自选 AI 服务 | DeepSeek 等 Chat Completions 接口、Messages 格式接口、多配置及术语表 |
| 用键盘操作 | 原生菜单、快捷键、可聚焦的公式和图片，以及辅助功能标签 |

`⌘O` 导入论文，`⌘,` 打开翻译设置，`⌃⌘S` 切换侧栏。右上角的「＋」可展开或收起导入栏，也可以点击栏内的关闭按钮或按 Esc 收起，未提交的网址会保留。图片预览和设置窗口都支持 Esc 关闭。

**Frontiers**　支持文章的 full、abstract 和 pdf 网址，导入时统一读取全文；使用官方 XML 保留公式和表格，图片使用原站资源。

**导入范围**　arXiv PDF 链接会转换为对应 HTML 来源，需要该论文已提供 HTML 全文。当前阅读流程面向网页全文，图片或在线资源的可用性取决于原站。

## 轻量化的实现

应用使用 AppKit 管理窗口，系统 WKWebView 排版论文，随应用打包的 Node.js 服务处理论文获取和模型请求。服务仅监听 `127.0.0.1:5173`，关闭最后一个窗口即退出。

新版按窗口大小约束阅读区域，将论文正文与列表元数据分开存储，减少重复正文和反复写入。全图预览在打开时创建，关闭时释放预览节点。

同一台 Apple Silicon Mac、同篇示例论文的本机测量中，打开后各相关进程 RSS 中位数由约 **365 MiB 降至 318 MiB**，滚动和切换视图后由约 **565 MiB 降至 325 MiB**。统计合计应用、WebKit 相关进程和本机服务，RSS 可能重复计算共享内存。实际占用随论文长度、图像和操作变化。

## 配置、数据与升级

推荐通过应用内的「翻译设置」管理 API 配置。也可在应用旁放置 `.env.local`，使用本机服务管理 DeepSeek 密钥，修改后重启应用。

```dotenv
DEEPSEEK_API_KEY=替换为自己的密钥
```

论文快照、译文和手动填写的接口配置保存在本机 WebKit 存储中。AI 翻译及公式解释会将所需论文片段发送到所选服务。手动填写的 API Key 以明文保存，导出的阅读数据也可能包含密钥，请妥善保存备份。

**升级原生版**　先退出旧版，再替换应用。应用标识保持为 `com.baigeiww.jiandu-reader`，沿用同一套本机阅读数据。建议替换前导出一次阅读数据。

**从 Electron 或网页版迁移**　在旧版「我的藏书」导出阅读数据，再在新版导入。不同客户端各自保存阅读库。

**端口占用**　如启动提示阅读服务停止，请先退出其他笺读实例，或停止使用本机 5173 端口的开发服务。

## 从源码构建

准备 Apple Silicon 版 **Node.js 22** 和 Xcode Command Line Tools。仓库中不包含 API Key，示例模式可用于验证阅读界面。

```sh
 git clone https://github.com/baigeiww/jiandu-reader.git
 cd jiandu-reader
 npm ci
 npm run desktop:build
 open ./笺读.app
```

重新构建前，退出并移开已有同名应用。安装包无需使用者另装 Node.js，源码构建需要 Node.js。

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 在浏览器中调试 |
| `npm test` | 解析、翻译、存储、备份和服务测试 |
| `npm run test:mac` | 在 Mac 系统 WebKit 中验证阅读交互及图片布局 |
| `npm run build` | 构建前端和本机服务 |
| `npm run desktop:build` | 打包 Mac 应用 |
| `npm run desktop:release` | 构建 DMG 和 SHA-256 校验文件，输出到 `output/releases/v0.4.1/` |

源码分别位于 [src/](src/)、[native/](native/) 和 [server/](server/)。发布包只收集构建产物、运行环境和第三方许可，打包流程不复制项目目录或本机阅读库。仓库的 Release 工作流会在主分支版本更新时构建安装包，也支持手动运行。

## 作者与开发协作

笺读采用人类主导、AI 协作的开发方式。

| 角色 | 参与方式 |
| --- | --- |
| 项目作者与维护者 · baigeiww | 提出产品方向与功能需求，提供实际使用反馈，决定功能取舍和版本发布 |
| AI 开发协作 · OpenAI Codex | 在作者的指导与反馈下，参与代码编写、Mac 原生适配、界面迭代、内存优化、问题修复、测试及打包发布 |

## 历史版本与内容权利

| 版本 | 位置 |
| --- | --- |
| 当前 Mac 原生版 | [main](https://github.com/baigeiww/jiandu-reader/tree/main) |
| 归档 Mac Electron 版 | [mac-electron](https://github.com/baigeiww/jiandu-reader/tree/mac-electron) |
| 初始网页版 | [初始提交](https://github.com/baigeiww/jiandu-reader/tree/50232f24a8e5e964b05720cc48f9a2575ce2b196) |

[示例论文](https://arxiv.org/abs/2602.04299) 及其图像、文字归原权利人。随附 ar5iv 样式采用 [MIT 许可证](public/vendor/ar5iv/LICENSE)，其他运行时及组件许可见 [native/licenses/](native/licenses/)。
