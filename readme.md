# koishi-plugin-dsh-connector

在聊天平台里控制同一台主机上运行的 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话：下发任务、查看历史、切换权限、处理授权请求，回复支持图片与长文分段。

> 插件市场里另有一个名为 `dsh` 的插件，与本插件无关；本插件包名为 `koishi-plugin-dsh-connector`。

```bash
npm i koishi-plugin-dsh-connector
```

需要 Koishi 4.18 及以上，且 DSH 网页服务正在运行（桌面版启动即自带，命令行版用 `dsh web`）。Koishi 与 DSH 应以同一系统用户运行，否则要把 `dshHome` 指向 DSH 主目录。

## 指令

主指令 `dsh`，括号内为中文别名。

| 指令 | 说明 |
| :--- | :--- |
| `dsh.ping`（`dsh状态`） | 连接状态与当前绑定 |
| `dsh.sessions`（`dsh会话`） | 会话列表，按工作目录分组，加 `-a` 放开数量上限 |
| `dsh.new [目录]`（`dsh新建`） | 新建并绑定会话 |
| `dsh.use 序号`（`dsh切换`） | 按序号绑定，也接受完整会话 ID 或唯一前缀 |
| `dsh.run 内容`（`dsh运行`） | 提交任务并等待结果 |
| `dsh.stop`（`dsh停止`） | 停止当前任务 |
| `dsh.history [条数]`（`dsh历史`） | 回放最近的助手回复 |
| `dsh.permission [预设]`（`dsh权限`） | 查看或切换权限预设 |
| `dsh.approve` / `dsh.deny`（`dsh允许` / `dsh拒绝`） | 处理 DSH 的授权请求 |
| `dsh.whoami`（`dsh我是谁`） | 查看自己的用户标识 |

- 每个聊天窗口有独立的会话绑定，互不影响；未绑定就发 `dsh.run` 时会自动新建一个。
- `dsh.sessions` 默认只列最近 20 个，按修改时间倒序，后创建的会话不会因为上限被漏掉；`-a` 放开到 60 个。
- `dsh.run` 会把消息附带的图片一并提交给 DSH；回复里的图片原样回传。
- `dsh.whoami` 不受白名单限制，被拒绝时也可以用它在配置里加入自己的标识。

## 说明

- **连接**：直连模式读取 `~/.dsh/.credentials.yaml` 的签名密钥本地现签 cookie；跨机时通过 relay 转发，填 `baseUrl` 与 `accessKey` 即可，DSH 凭据由 relay 注入。
- **端口发现**：DSH 每次启动会换端口，插件读取本机回环监听端口并逐个探测，用 `dsh web authentication required` 这段指纹识别。
- **结果判定**：轮询 `session/projections` 取游标、`session/page` 翻页，直到出现 `turn/end`；同一轮里每条工具步骤都会产出 `assistant/message`，只取 `turn/end` 之前最后一条。
- **图片**：从回复中收集附件、`data:` 与 http(s) 地址以及正文里的 Markdown 图片；聊天里的图片按类型嗅探后内联给 DSH，指向本机的非图片文件会被忽略。
- **长回复**：超过 `splitLength` 时按换行、句号、逗号切段；`mergeForward` 开启且平台支持（OneBot）时把每段打包成合并转发，否则逐条发送。
- **权限**：DSH 没有改权限的 RPC，`dsh.permission` 调用官方 `/permission` 斜杠命令，预设同时决定沙箱模式与审批策略：`read-only`、`workspace-write`、`danger-full-access`、`auto`（自动审查）。`defaultPermission` 会在新建会话时自动应用。
- **持久化**：会话绑定表保存在 `data/koishi-plugin-dsh-connector/bindings.json`，Koishi 重启后授权请求仍能推回原聊天。

## 配置

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `mode` | `auto` | `auto` / `direct` / `relay`：填了 `accessKey` 走 relay，否则直连 |
| `baseUrl` | 空 | DSH 地址；留空自动发现端口，固定端口或 relay 时填写 |
| `dshHome` | 空 | DSH 主目录，留空取 `DSH_HOME` 或 `~/.dsh` |
| `accessKey` | 空 | relay 访问密钥，仅跨机访问时填写 |
| `pollInterval` | `1200` | 结果轮询间隔（毫秒） |
| `promptTimeout` | `600` | 单轮任务等待上限（秒） |
| `historyLimit` | `5` | `dsh.history` 默认回放条数 |
| `sessionLimit` | `20` | `dsh.sessions` 默认显示最近多少个会话 |
| `clientTimeZone` | `Asia/Shanghai` | 随任务提交的 IANA 时区名 |
| `replyFormat` | `text` | `text` 转纯文本（QQ 不渲染 Markdown），`markdown` 保留原文 |
| `splitLength` | `1500` | 超过该字数才特殊处理，`0` 表示始终处理 |
| `chunkLength` | `1500` | 分段每段、合并转发每个节点的最大字数 |
| `mergeForward` | `false` | 长回复改用合并转发，仅 OneBot 支持 |
| `allowUsers` | 空 | 用户白名单，写 `平台:用户ID` 或裸用户 ID；留空表示谁都不能用 |
| `defaultPermission` | 不设置 | 新建会话自动切换到的权限预设 |
| `enableImages` | `true` | 回传图片与附件 |
| `maxImages` | `6` | 单轮图片上限，`0` 表示关闭 |
| `maxImageMb` | `8` | 单张图片体积上限（MB） |
| `debug` | `false` | 输出 RPC、端口发现与未识别事件帧 |

## 依赖

- `ws`：DSH 的授权请求只经 WebSocket（`/api/remote.mux`）下发，HTTP 无法接收。
- `koishi`：插件运行时（peer 依赖）。

## 已知限制

- 授权结论的取值（`allow` / `deny`）按 `$events/result` 协议实现，尚未在真实授权请求上验证。
- `dsh.history` 只回放文本，不带图片。
- DSH 的内部接口名随版本变动（0.2 已移除 `session/history`、`workspace.list`），升级后若指令报 404，需要同步更新 `src/services/dsh.ts` 里的方法名。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-dsh-connector/blob/master/LICENSE)
