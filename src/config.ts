import { Schema } from 'koishi'
import { PERMISSION_PRESETS, presetLabel } from './constants'

export interface Config {
  mode: 'auto' | 'direct' | 'relay'
  baseUrl: string
  dshHome: string
  accessKey: string
  pollInterval: number
  promptTimeout: number
  historyLimit: number
  sessionLimit: number
  clientTimeZone: string
  replyFormat: 'text' | 'markdown'
  allowUsers: string[]
  /** 新建会话后自动切换到的权限预设；空串表示沿用 DSH 默认 */
  defaultPermission: string
  /** 新建会话使用的工作区；空串表示用 DSH 默认目录 */
  defaultWorkspace: string
  /** 私聊里不带指令前缀的消息直接交给 DSH */
  naturalLanguagePrivate: boolean
  /** 自然语言模式的空闲窗口（分钟） */
  chatIdleMinutes: number
  /** 会话列表分组方式 */
  sessionGroupBy: 'workspace' | 'flat'
  /** 会话列表排序方式 */
  sessionSortBy: 'manual' | 'updated'
  /** 会话列表筛选方式 */
  sessionFilter: 'active' | 'all' | 'archived'
  mergeForward: boolean
  splitLength: number
  chunkLength: number
  enableImages: boolean
  maxImages: number
  maxImageMb: number
  enableFiles: boolean
  maxFileMb: number
  /** 每轮回复后附带 token 用量 */
  showUsage: boolean
  /** 用量里同时给出估算费用 */
  showCost: boolean
  /** 余额低于该值时提醒；0 表示关闭 */
  balanceWarning: number
  debug: boolean
}

export const Config: Schema<Config> = Schema.intersect([
  Schema.object({
    mode: Schema.union([
      Schema.const('auto').description('自动'),
      Schema.const('direct').description('直连'),
      Schema.const('relay').description('relay'),
    ])
      .default('auto')
      .description('**连接方式**<br>有密钥走 relay，否则直连'),
    baseUrl: Schema.string()
      .default('')
      .description('**DSH 地址**<br>留空自动发现端口'),
    dshHome: Schema.string()
      .default('')
      .description('**DSH 主目录**<br>留空取环境变量或 `~/.dsh`'),
    accessKey: Schema.string()
      .role('secret')
      .default('')
      .description('**relay 密钥**<br>仅跨机访问时填写'),
  }).description('连接'),

  Schema.object({
    defaultWorkspace: Schema.string()
      .default('')
      .description('**默认工作区**<br>`dsh.new` 不带参数时使用'),
    sessionLimit: Schema.natural()
      .min(1)
      .max(200)
      .default(20)
      .description('**列表条数**<br>`dsh.sessions` 默认显示多少条'),
    sessionGroupBy: Schema.union([
      Schema.const('workspace').description('按工作区'),
      Schema.const('flat').description('单列表'),
    ])
      .default('workspace')
      .description('**分组方式**<br>按 DSH 工作区或单列表'),
    sessionSortBy: Schema.union([
      Schema.const('updated').description('最近更新'),
      Schema.const('manual').description('手动排序'),
    ])
      .default('updated')
      .description('**排序方式**<br>最近更新或手动顺序'),
    sessionFilter: Schema.union([
      Schema.const('active').description('隐藏已归档'),
      Schema.const('all').description('全部会话'),
      Schema.const('archived').description('仅已归档'),
    ])
      .default('active')
      .description('**归档筛选**<br>归档状态取自 DSH 工作区'),
  }).description('会话'),

  Schema.object({
    replyFormat: Schema.union([
      Schema.const('text').description('纯文本'),
      Schema.const('markdown').description('保留 Markdown'),
    ])
      .default('text')
      .description('**回复格式**<br>QQ 默认转纯文本'),
    splitLength: Schema.natural()
      .min(0)
      .max(5000)
      .step(100)
      .default(1500)
      .description('**分段阈值**<br>超过该字数才分段；`0` 表示始终'),
    chunkLength: Schema.natural()
      .min(200)
      .max(5000)
      .step(100)
      .default(1500)
      .description('**分段长度**<br>每段与每个转发节点的上限'),
    mergeForward: Schema.boolean()
      .default(false)
      .description('**合并转发**<br>长回复打包成一条，仅 OneBot'),
  }).description('回复'),

  Schema.object({
    naturalLanguagePrivate: Schema.boolean()
      .default(false)
      .description('**私聊直通**<br>不带前缀的消息直接交给 DSH'),
    chatIdleMinutes: Schema.natural()
      .min(0)
      .max(1440)
      .default(30)
      .description('**直通窗口**<br>多少分钟内交互过才生效'),
    pollInterval: Schema.natural()
      .min(300)
      .max(10000)
      .step(100)
      .default(1200)
      .description('**轮询间隔**<br>单位毫秒'),
    promptTimeout: Schema.natural()
      .min(10)
      .max(3600)
      .default(600)
      .description('**等待上限**<br>超时后继续执行并补发结果'),
    clientTimeZone: Schema.string()
      .default('Asia/Shanghai')
      .description('**时区**<br>IANA 名称，如 `Asia/Shanghai`'),
    historyLimit: Schema.natural()
      .min(1)
      .max(50)
      .default(5)
      .description('**历史条数**<br>`dsh.history` 默认条数'),
  }).description('交互'),

  Schema.object({
    allowUsers: Schema.array(Schema.string())
      .role('table')
      .default([])
      .description('**用户白名单**<br>写 `平台:用户ID` 或裸 ID；留空谁都不能用'),
    defaultPermission: Schema.union([
      Schema.const('').description('不设置'),
      ...PERMISSION_PRESETS.map((value) => Schema.const(value).description(presetLabel(value))),
    ])
      .default('')
      .description('**新建会话权限**<br>不设置则沿用 DSH 默认'),
  }).description('权限'),

  Schema.object({
    enableImages: Schema.boolean()
      .default(true)
      .description('**回传图片**<br>把回复里的图片转成聊天图片'),
    maxImages: Schema.natural()
      .min(0)
      .max(20)
      .default(6)
      .description('**图片上限**<br>单轮张数，`0` 表示关闭'),
    maxImageMb: Schema.natural()
      .min(1)
      .max(64)
      .default(8)
      .description('**单张图片**<br>上限 MB'),
    enableFiles: Schema.boolean()
      .default(true)
      .description('**收发文件**<br>接收聊天文件，也可用 `dsh.get` 取回'),
    maxFileMb: Schema.natural()
      .min(1)
      .max(200)
      .default(20)
      .description('**单个文件**<br>上限 MB'),
  }).description('附件'),

  Schema.object({
    showUsage: Schema.boolean()
      .default(true)
      .description('**显示用量**<br>每轮附带 token 消耗'),
    showCost: Schema.boolean()
      .default(true)
      .description('**估算费用**<br>按官方价目表换算'),
    balanceWarning: Schema.number()
      .min(0)
      .max(10000)
      .step(1)
      .default(0)
      .description('**余额告警**<br>低于该金额（元）时提醒，`0` 关闭'),
  }).description('用量'),

  Schema.object({
    debug: Schema.boolean()
      .default(false)
      .description('**调试日志**<br>输出连接、RPC、事件桥、提问与回合过程'),
  }).description('调试'),
])

/** 运行时夹逼：`koishi.yml` 手改或旧配置升级都可能绕过 Schema 约束 */
export function normalizeConfig(config: Config): Config {
  return {
    ...config,
    mode: config.mode ?? 'auto',
    baseUrl: (config.baseUrl ?? '').trim().replace(/\/+$/, ''),
    dshHome: (config.dshHome ?? '').trim(),
    accessKey: (config.accessKey ?? '').trim(),
    pollInterval: Math.max(300, Math.min(10000, config.pollInterval ?? 1200)),
    promptTimeout: Math.max(10, Math.min(3600, config.promptTimeout ?? 600)),
    historyLimit: Math.max(1, Math.min(50, config.historyLimit ?? 5)),
    sessionLimit: Math.max(1, Math.min(200, config.sessionLimit ?? 20)),
    defaultWorkspace: (config.defaultWorkspace ?? '').trim(),
    naturalLanguagePrivate: config.naturalLanguagePrivate ?? false,
    chatIdleMinutes: Math.max(0, Math.min(1440, config.chatIdleMinutes ?? 30)),
    sessionGroupBy: config.sessionGroupBy === 'flat' ? 'flat' : 'workspace',
    sessionSortBy: config.sessionSortBy === 'manual' ? 'manual' : 'updated',
    sessionFilter:
      config.sessionFilter === 'all' || config.sessionFilter === 'archived'
        ? config.sessionFilter
        : 'active',
    clientTimeZone: (config.clientTimeZone ?? '').trim() || 'Asia/Shanghai',
    replyFormat: config.replyFormat === 'markdown' ? 'markdown' : 'text',
    allowUsers: (config.allowUsers ?? []).map((id) => String(id).trim()).filter(Boolean),
    defaultPermission: PERMISSION_PRESETS.includes(config.defaultPermission ?? '')
      ? config.defaultPermission
      : '',
    mergeForward: config.mergeForward ?? false,
    splitLength: Math.max(0, Math.min(5000, config.splitLength ?? 1500)),
    chunkLength: Math.max(200, Math.min(5000, config.chunkLength ?? 1500)),
    enableImages: config.enableImages ?? true,
    maxImages: Math.max(0, Math.min(20, config.maxImages ?? 6)),
    maxImageMb: Math.max(1, Math.min(64, config.maxImageMb ?? 8)),
    enableFiles: config.enableFiles ?? true,
    maxFileMb: Math.max(1, Math.min(200, config.maxFileMb ?? 20)),
    showUsage: config.showUsage ?? true,
    showCost: config.showCost ?? true,
    balanceWarning: Math.max(0, Math.min(10000, config.balanceWarning ?? 0)),
    debug: config.debug ?? false,
  }
}
