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
| `dsh.new [目录]` | 新建并绑定会话 |
| `dsh.use 序号` | 按序号或会话 ID 绑定 |
| `dsh.run 内容` | 下发任务并等待结果 |
| `dsh.stop` | 停止当前任务 |
| `dsh.history [条数]` | 回放最近的回复 |
| `dsh.permission [预设]` | 查看或切换权限预设 |
| `dsh.approve` / `dsh.deny` | 处理授权请求 |
| `dsh.whoami` | 查看自己的用户标识 |

- 每个聊天独立绑定会话，未绑定时 `dsh.run` 会自动新建。
- `dsh.sessions` 默认列最近 20 个，按修改时间倒序；`-a` 放开到 60 个。
- `dsh.run` 会提交消息附带的图片，回复里的图片也会回传；长回复自动分段或合并转发。
- `dsh.whoami` 不受白名单限制，被拒绝时可用它取到自己的标识。

## 配置

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `allowUsers` | 空 | 用户白名单，写 `平台:用户ID`；留空则谁都不能用 |
| `mode` / `baseUrl` / `dshHome` / `accessKey` | `auto` / 空 | 连接方式；直连留空自动发现端口，跨机走 relay 时填 `baseUrl` 与 `accessKey` |
| `defaultPermission` | 不设置 | 新建会话使用的权限预设 |
| `replyFormat` / `splitLength` / `chunkLength` | `text` / `1500` / `1500` | 回复格式，以及长文的触发长度与分段大小 |
| `mergeForward` | `false` | 长回复改用合并转发，仅 OneBot 支持 |
| `enableImages` / `maxImages` / `maxImageMb` | `true` / `6` / `8` | 图片回传开关与数量、体积上限 |
| `sessionLimit` / `historyLimit` | `20` / `5` | 会话列表与历史回复的默认条数 |
| `pollInterval` / `promptTimeout` | `1200` / `600` | 轮询间隔（毫秒）与等待上限（秒） |
| `clientTimeZone` | `Asia/Shanghai` | 随任务提交的时区 |
| `debug` | `false` | 输出调试日志 |

运行依赖 `ws`，用于接收 DSH 的授权请求。

## 注意

- 授权结论的取值尚未在真实授权请求上验证。
- `dsh.history` 只回放文本；DSH 升级后若指令报 404，需要更新插件。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-dsh-connector/blob/master/LICENSE)
