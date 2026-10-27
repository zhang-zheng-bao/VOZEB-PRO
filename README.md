<p align="center">
  <img src="web/public/wanchuang-core-logo.png" width="108" alt="万创核心 Logo">
</p>

<h1 align="center">万创核心 · 本地个人版</h1>

<p align="center">基于 VOZEB PRO 定制的本地 AI 创作工作台，支持远程 ComfyUI / MiniMax H3 视频工作流。</p>

## 项目说明

本仓库保存基于 [VOZEB PRO](https://github.com/csyqlz/VOZEB-PRO) v0.0.6 的本地个人定制。界面、任务调度和业务数据运行在自己的电脑上；图片、视频和音频推理由配置的模型服务或 ComfyUI 服务器执行。

当前分支包含本地个人模式、独立设置入口、ComfyUI 服务器管理、SSH 隧道、MiniMax H3 工作流，以及 Canvas 和短剧创作适配。上传 Git 不会同步本机的数据、密钥、服务器密码或模型文件。

## 主要功能

- **统一创作**：在同一工作台处理文本、图片、视频和音频，支持参考素材、模型参数、生成记录、重试和下载。
- **Canvas 画布**：文本和媒体节点、拖拽连线、生成节点、引用素材、项目保存及恢复。
- **MiniMax H3 工作流**：通过 ComfyUI 提交视频生成工作流，支持参考图片、视频、音频及不同质量模式。
- **远程服务器**：添加、选择和切换 ComfyUI 服务器，通过 SSH 隧道连接，查看连接与服务状态。
- **短剧制作**：剧本、角色、场景、道具、分镜和镜头生成，包含风格与资产一致性相关调整。
- **本地管理**：独立设置入口、本地素材、生成任务和文件 Provider；业务数据保存在本机服务目录。

## 本地启动

准备 Node.js 和 pnpm。依赖版本以 `web/package.json`、`web/pnpm-lock.yaml` 为准。

在仓库根目录执行：

```powershell
pnpm -C web install --frozen-lockfile
Copy-Item .env.example web/.env.local
```

编辑 `web/.env.local`，启用个人模式并配置本机地址：

```dotenv
VOZEB_PRO_PERSONAL_MODE=true
NEXT_PUBLIC_VOZEB_PRO_PERSONAL_MODE=true
VOZEB_PRO_DATABASE_PROVIDER=file
NEXT_PUBLIC_SITE_URL=http://localhost:3000
VOZEB_PRO_INTERNAL_ORIGIN=http://127.0.0.1:3000
PORT=3000
```

保留模板中其他必需配置，填写自己生成的密钥。生产启动要求 `VOZEB_PRO_MAINTENANCE_TOKEN` 和 `VOZEB_PRO_WORKER_TOKEN` 各不少于 32 位，且两者不同；服务端凭证加密相关配置见[配置说明](docs/content/docs/overview/configuration.mdx)。不要把实际密钥写进 README 或提交 Git。

首次运行或代码更新后构建：

```powershell
pnpm -C web build
```

之后双击根目录的 **启动本地个人版.bat**，打开：

[http://localhost:3000/create](http://localhost:3000/create)

需要调试代码时可用 `pnpm -C web dev`。个人模式使用固定本地管理员身份，默认监听本机回环地址，应保持为本人本机使用。启动器会同时管理应用和生成 Worker。

## 连接 MiniMax H3 / ComfyUI

1. 在推理服务器准备 ComfyUI、MiniMax H3 所需模型、自定义节点和工作流运行环境。
2. 在本地设置中启用 ComfyUI 协议渠道，并填写匹配实际服务器的工作流 JSON 配置。
3. 使用 SSH 连接时，将渠道 Base URL 设为 `http://127.0.0.1:本地端口`，再在服务器管理中填写服务器地址、SSH 端口、用户名、密码和远程 ComfyUI 端口。
4. 选择服务器，确认隧道与 ComfyUI 状态，随后在画布选择服务器模型、参考素材及生成参数并提交。
5. 生成结果由应用取回，进入本地媒体与任务记录，可在界面中查看和下载。

工作流配置与远端节点必须匹配。Git 仓库提供调用与工作流适配代码；远端模型文件和 GPU 环境由使用者准备。不同参考素材、质量模式和断线恢复的验收范围见[待测试清单](docs/content/docs/progress/pending-test.mdx)。

## 数据与更新

- 根目录启动脚本将文件 Provider 数据放在 `web/.data`；更新前备份数据目录和 `web/.env.local`，迁移机器时同时保留原加密密钥。
- Git 仅保存代码、文档、依赖清单与公开资源。本机模型、业务数据、服务器凭证和截图缓存不随本次推送上传。
- 版本号继续沿用 `v0.0.6`，本次为本地定制分支同步，未发布新的安装包。
- 与远端主分支的后续合并需核对双方改动，避免直接覆盖本地定制或远端已有提交。

## 文档

- [文档索引](docs/index.md)
- [配置说明](docs/content/docs/overview/configuration.mdx)
- [Canvas 操作手册](docs/content/docs/canvas/canvas-node-manual.mdx)
- [待测试内容](docs/content/docs/progress/pending-test.mdx)
- [后续事项](docs/content/docs/progress/todo.mdx)
- [更新记录](CHANGELOG.md)

## 来源与许可证

本项目基于 csyqlz/VOZEB-PRO 修改，保留上游版权与署名。此分支的许可条款见 [LICENSE](LICENSE)，第三方依赖及素材说明见 [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)。
