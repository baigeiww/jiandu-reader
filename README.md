# 笺读

在 Mac 上对照阅读英文论文。粘贴 arXiv、Nature 或 PMC 的 HTML 全文链接，即可逐段翻译、查看图注，或点选公式了解符号在当前段落中的含义。论文快照和已完成的译文保存在本机。

## 选择版本

| 版本 | 窗口与阅读体验 | 同篇论文空闲内存¹ |
| --- | --- | ---: |
| **Mac 原生版（当前）** | AppKit 窗口，使用系统 WebKit 排版 | **约 344 MiB** |
| [Mac Electron 版](https://github.com/baigeiww/jiandu-reader/tree/mac-electron) | 旧版独立桌面窗口，内置 Chromium | 约 596 MiB |
| [初始网页版](https://github.com/baigeiww/jiandu-reader/tree/50232f24a8e5e964b05720cc48f9a2575ce2b196) | 在浏览器中阅读 | — |

¹ 在同一台 Apple Silicon Mac 上打开同一篇示例论文并静置，合计应用、渲染和本地服务进程的 RSS。共享内存可能重复计入。按此口径，原生版比 Electron 版低约 42%。

## 从源码启动原生版

在 Apple Silicon Mac 上准备 Xcode Command Line Tools 和 **Node.js 22**（实测 22.23.4，建议使用官方 macOS 二进制包）。在仓库目录执行：

```sh
npm ci
npm run desktop:build
open ./笺读.app
```

以后直接双击项目目录里的 **笺读.app**。阅读服务使用本机端口 5173，关闭最后一个窗口即退出。重新构建前，请先退出并移开已有的同名应用。

**配置 DeepSeek**　需要 AI 翻译或公式解释时，在应用旁新建 `.env.local`，填入下面一行，将占位文字替换为自己的 Key，然后重启应用。本机服务负责发送请求。也可在「翻译设置」中管理自己的接口和模型。

```dotenv
DEEPSEEK_API_KEY=替换为自己的密钥
```

## 阅读一篇论文

1. **导入**　粘贴论文网址或 arXiv 编号，也可打开内置示例。arXiv PDF 链接会转换为 HTML 来源，需要该论文提供 HTML 全文。
2. **对照**　在原文、双语和译文视图间切换。支持翻译单段、选区、正文和图注，已完成的段落会保存，重新打开可继续。
3. **理解公式**　点击公式或用键盘聚焦并按 Enter，在浮窗中查看符号、位置和模型解释。公式、引用和表格都保留在正文里。
4. **整理**　在侧栏创建分组、归并版本、查看已译段数。不同客户端各自保存论文库。

**从旧版迁移**　在旧版侧栏点击「导出阅读数据」，然后在原生版选择「导入阅读数据」。导入会核对论文、译文、分组和配置。备份可能含手动填写的 API Key，请保存在自己的设备上。

## 开发与验证

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 在浏览器中调试阅读界面 |
| `npm test` | 验证解析、翻译、存储、备份和本机服务 |
| `npm run build` | 构建网页和本机服务 |
| `npm run desktop:build` | 构建并打包 Mac 原生应用 |

阅读界面位于 [src/](src/)，原生窗口位于 [native/](native/)，本地 HTTP 服务位于 [server/](server/)。[示例论文](https://arxiv.org/abs/2602.04299) 及其内容归原权利人，随附的 ar5iv 样式使用 [MIT 许可证](public/vendor/ar5iv/LICENSE)。
