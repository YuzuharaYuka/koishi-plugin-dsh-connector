# koishi-plugin-dsh-connector

在聊天平台里控制 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话：下发任务、查看历史、切换权限、处理授权。

```bash
npm i koishi-plugin-dsh-connector
```

需要 Koishi 4.18 及以上，且 DSH 网页服务正在运行；Koishi 与 DSH 应以同一系统用户运行，否则配置 `dshHome`。

## 指令

| 指令 | 说明 |
| :--- | :--- |
| `dsh.ping` | 连接状态与当前绑定 |
| `dsh.sessions` | 会话列表，`-a` 显示全部 |
| `dsh.new [目录/序号]` | 新建并绑定会话，可指定工作区 |
| `dsh.workspaces` | 列出已知工作区 |
| `dsh.use 序号` | 按序号或会话 ID 绑定 |
| `dsh.run 内容` | 下发任务并等待结果 |
| `dsh.stop` | 停止当前任务 |
| `dsh.history [条数]` | 回放最近的回复 |
| `dsh.model [序号] [等级]` | 查看或切换模型与思考等级 |
| `dsh.think [等级]` | 只调整思考等级 |
| `dsh.get 路径` | 取回工作区里的文件 |
| `dsh.permission [预设]` | 查看或切换权限预设 |
| `dsh.approve` / `dsh.deny` | 处理授权请求 |
| `dsh.whoami` | 查看自己的用户标识 |

- 每个聊天独立绑定会话，未绑定时 `dsh.run` 会自动新建。
- `dsh.sessions` 默认列最近 20 个，按修改时间倒序；`-a` 列出全部。
- `dsh.new` 不带参数时使用配置项 `defaultWorkspace`，也可给序号或绝对路径。
- 思考等级为 `off` / `low` / `high` / `max`，切换模型时未指定等级会沿用当前值。
- `dsh.run` 会提交消息附带的图片和文件，回复里的图片也会回传；长回复自动分段或合并转发。
- `dsh.whoami` 不受白名单限制，被拒绝时可用它取到自己的标识。

## 配置

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `mode` | `auto` | `auto` / `direct` / `relay` |
| `baseUrl` | 空 | DSH 地址，留空自动发现端口 |
| `dshHome` | 空 | DSH 主目录，留空取 `DSH_HOME` 或 `~/.dsh` |
| `accessKey` | 空 | relay 访问密钥，仅跨机访问时填写 |
| `pollInterval` | `1200` | 结果轮询间隔（毫秒） |
| `promptTimeout` | `600` | 单轮任务等待上限（秒） |
| `historyLimit` | `5` | `dsh.history` 默认回放条数 |
| `sessionLimit` | `20` | `dsh.sessions` 默认显示条数 |
| `defaultWorkspace` | 空 | `dsh.new` 不带参数时使用的工作区 |
| `clientTimeZone` | `Asia/Shanghai` | 随任务提交的时区 |
| `replyFormat` | `text` | `text` 转纯文本，`markdown` 保留原文 |
| `splitLength` | `1500` | 超过该字数才分段，`0` 表示始终 |
| `chunkLength` | `1500` | 分段每段、合并转发每个节点的最大字数 |
| `mergeForward` | `false` | 长回复改用合并转发，仅 OneBot 支持 |
| `allowUsers` | 空 | 用户白名单，写 `平台:用户ID`；留空则谁都不能用 |
| `defaultPermission` | 不设置 | 新建会话使用的权限预设 |
| `enableImages` | `true` | 回传图片与附件 |
| `maxImages` | `6` | 单轮图片上限，`0` 表示关闭 |
| `maxImageMb` | `8` | 单张图片体积上限（MB） |
| `enableFiles` | `true` | 收发文件 |
| `maxFileMb` | `20` | 单个文件体积上限（MB） |
| `debug` | `false` | 输出调试日志 |

运行依赖 `ws`，用于接收 DSH 的授权请求。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-dsh-connector/blob/master/LICENSE)
