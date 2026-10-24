# koishi-plugin-dsh-connector

在聊天平台里控制 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 会话：下发任务、查看历史、切换权限、处理授权。

```bash
npm i koishi-plugin-dsh-connector
```

需要 Koishi 4.18 及以上，且 DSH 网页服务在运行；两者不是同一系统用户时配置 `dshHome`。

回复可以转成图片（按 DSH 的深色/浅色配色），这需要一个提供 puppeteer 服务的插件，例如 `koishi-plugin-puppeteer`；没有该服务时自动回退纯文本。

> 配置页右侧有可拖动的悬浮导航，下面的配置表也按同一顺序分组。

[指令](#指令) · [配置](#配置) · [说明](#说明) · [License](#license)

## 指令

| 指令 | 说明 |
| :--- | :--- |
| `dsh.ping` | 连接状态、工作区、模型、权限与任务状态 |
| `dsh.sessions` | 会话列表，按工作区分组，`-a` 显示全部 |
| `dsh.use 序号` | 按序号或会话 ID 绑定 |
| `dsh.new [目录/序号]` | 新建并绑定会话 |
| `dsh.workspaces` | 列出已知工作区 |
| `dsh.archive [序号]` / `dsh.unarchive [序号]` | 归档或恢复会话，省略参数时操作当前绑定 |
| `dsh.run 内容` | 下发任务并等待结果 |
| `dsh.steer 内容` | 往运行中的任务补充指令 |
| `dsh.stop` | 停止当前任务 |
| `dsh.history [条数]` | 回放最近的回复 |
| `dsh.compact` / `dsh.clear` | 压缩或清空上下文 |
| `dsh.model [序号] [等级]` | 查看或切换模型与思考等级 |
| `dsh.think [等级]` | 只调整思考等级 |
| `dsh.get 路径` | 取回工作区里的文件 |
| `dsh.chat on/off` | 私聊自然语言模式 |
| `dsh.balance` | 查看账户余额 |
| `dsh.permission [预设]` | 查看或切换权限预设 |
| `dsh.approve` / `dsh.deny` | 处理授权请求 |
| `dsh.whoami` | 查看自己的用户标识 |

## 配置

### 连接

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `mode` | `auto` | `auto` / `direct` / `relay` |
| `baseUrl` | 空 | DSH 地址，留空自动发现端口 |
| `dshHome` | 空 | DSH 主目录，留空取环境变量或 `~/.dsh` |
| `accessKey` | 空 | relay 访问密钥，仅跨机时填写 |

### 会话

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `defaultWorkspace` | 空 | `dsh.new` 不带参数时使用的工作区 |
| `sessionLimit` | `20` | `dsh.sessions` 默认显示条数 |
| `sessionGroupBy` | `workspace` | `workspace` 按工作区 / `flat` 单列表 |
| `sessionSortBy` | `updated` | `updated` 最近更新 / `manual` 手动排序 |
| `sessionFilter` | `active` | `active` 隐藏已归档 / `all` 全部 / `archived` 仅已归档 |
| `pollInterval` | `1200` | 结果轮询间隔（毫秒） |
| `promptTimeout` | `600` | 单轮等待上限（秒），超时后继续执行并补发 |
| `clientTimeZone` | `Asia/Shanghai` | 随任务提交的时区 |
| `historyLimit` | `5` | `dsh.history` 默认条数 |

### 回复

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `replyFormat` | `text` | `text` 转纯文本 / `markdown` 保留原文 / `image` 转图片 |
| `splitLength` | `1500` | 超过该字数才分段，`0` 表示始终 |
| `chunkLength` | `1500` | 每段与每个转发节点的最大字数 |
| `mergeForward` | `false` | 长回复合并转发，仅 OneBot |

### 图片

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `imageTheme` | `dark` | `dark` 深色 / `light` 浅色，与 DSH 界面一致 |
| `imageMaxWidth` | `720` | 正文宽度（像素），`720` 适合手机 |
| `imageMinLength` | `200` | 更短的回复仍发文本，`0` 表示都转图片 |

### 交互

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `naturalLanguagePrivate` | `false` | 私聊里不带前缀的消息直接交给 DSH |
| `chatIdleMinutes` | `30` | 多少分钟内交互过才直通 |

### 权限

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `allowUsers` | 空 | 用户白名单，写 `平台:用户ID` 或裸 ID；留空谁都不能用 |
| `defaultPermission` | 不设置 | 新建会话使用的权限预设 |

### 附件

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `enableImages` | `true` | 回传图片 |
| `maxImages` | `6` | 单轮图片上限，`0` 表示关闭 |
| `maxImageMb` | `8` | 单张图片体积上限（MB） |
| `enableFiles` | `true` | 收发文件 |
| `maxFileMb` | `20` | 单个文件体积上限（MB） |

### 用量

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `showUsage` | `true` | 每轮回复后附带 token 用量 |
| `showCost` | `true` | 用量里同时给出估算费用 |
| `balanceWarning` | `0` | 余额低于该金额（元）时提醒，`0` 关闭 |

### 调试

| 配置项 | 默认值 | 说明 |
| :--- | :--- | :--- |
| `debug` | `false` | 输出连接、RPC、事件桥、提问与回合过程的日志 |

## 说明

- **绑定**：每个聊天独立绑定会话，未绑定时 `dsh.run` 自动新建。
- **会话列表**：按 DSH 工作区分组，组名即工作区名；归档状态取自工作区基线，不在任何工作区的会话归入「未分组」。
- **附件**：消息附带的图片与文件会一起提交。QQ 不能把文字和文件放进同一条消息，引用一条带附件的消息再发 `dsh.run` 即可。
- **交互**：agent 提问时回复序号即可（多选逗号分隔，也可回文字），任一边回答都有效，聊天的待答状态在回合结束或 5 分钟后失效；运行中可用 `dsh.steer`。`dsh.chat on` 后私聊自然语言直通。
- **超时**：等待超时后任务不丢，后台继续跟踪并把结果补发到原聊天；补发同样遵循当前回复设置。
- **回复格式**：纯文本用 marked 重排，标题、列表、表格、引用、代码块都保留结构；图片按 DSH 的配色与字号渲染，公式走 KaTeX 转 MathML，过短或过长的回复自动回退文本。图片模式下用量与余额提示单独成一条。
- **用量**：DSH 没有花费接口，`showCost` 按官方价目表（区分缓存命中与高峰时段）估算，仅供参考。
- **断线**：事件桥按 2 秒到 5 分钟退避重试，空闲且连续失败 5 次后暂停，下一条指令自动唤醒。

## License

[MIT](https://github.com/YuzuharaYuka/koishi-plugin-dsh-connector/blob/master/LICENSE)
