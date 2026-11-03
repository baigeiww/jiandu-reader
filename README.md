# 笺读 · Mac Electron 版

笺读是一个本地论文阅读器，支持导入 arXiv、Nature 和 PMC 的 HTML 全文。在原文段落下方显示中文译文，保留公式、引用、表格和图注。

| 版本 | 用途 |
| --- | --- |
| **本分支 · Electron** | 重建旧版 Apple Silicon 桌面应用，继续使用原来的论文库 |
| [Mac 原生版](https://github.com/baigeiww/jiandu-reader/tree/main) | 使用系统 WebKit，在相同样例上占用更少内存 |
| [初始网页版](https://github.com/baigeiww/jiandu-reader/tree/50232f24a8e5e964b05720cc48f9a2575ce2b196) | 查看最初上传的浏览器版本 |

## 在 Apple Silicon Mac 上构建

准备 Node.js 22.23.4 或兼容的 22.x 版本，在项目目录运行：

```sh
npm ci
npm install --prefix .runtime/desktop-tools electron@45.2.1 @electron/packager@20.3.0
npm run desktop:build
open ./笺读.app
```

构建结果位于项目根目录。启动时应用从同目录读取 `dist/`、`dist-server/` 和可选的 `.env.local`。使用 DeepSeek 时，在该文件中设置 `DEEPSEEK_API_KEY`，保存后重启。

## 阅读与迁移

- 粘贴论文链接或 arXiv 编号，选择原文、译文或双语视图。
- 翻译单段、选区、图注或全文。点击公式可查看符号和上下文解释。
- 论文与已译段落保存在本机。切换到原生版前，在侧栏选择「导出阅读数据」，然后在新版选择「导入阅读数据」。备份可能包含自行填写的 API Key，请私下保存。

运行 `npm test` 检查阅读、翻译、存储和本地服务。示例论文和 ar5iv 样式的权利归各自权利人，样式许可证见 [LICENSE](public/vendor/ar5iv/LICENSE)。
