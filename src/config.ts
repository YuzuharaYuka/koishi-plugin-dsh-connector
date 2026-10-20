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
  mergeForward: boolean
  splitLength: number
  chunkLength: number
  enableImages: boolean
  maxImages: number
  maxImageMb: number
  enableFiles: boolean
  maxFileMb: number
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
      .description('**连接方式**<br>自动：有访问密钥走 relay，否则直连'),
    baseUrl: Schema.string()
      .default('')
      .description('**DSH 地址**<br>留空自动发现端口；固定端口或 relay 时填写'),
    dshHome: Schema.string()
      .default('')
      .description('**DSH 主目录**<br>留空取 `DSH_HOME` 或 `~/.dsh`，需含 `.credentials.yaml`'),
    accessKey: Schema.string()
      .role('secret')
      .default('')
      .description('**relay 访问密钥**<br>仅跨机访问时填写'),
  }).description('连接设置'),

  Schema.object({
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
      .description('**等待上限**<br>单位秒，超时后任务仍在 DSH 继续'),
    historyLimit: Schema.natural()
      .min(1)
      .max(50)
      .default(5)
      .description('**历史条数**<br>`dsh.history` 默认条数'),
    sessionLimit: Schema.natural()
      .min(1)
      .max(200)
      .default(20)
      .description('**列表上限**<br>`dsh.sessions` 默认显示最近多少个会话'),
    defaultWorkspace: Schema.string()
      .default('')
      .description('**默认工作区**<br>`dsh.new` 不带参数时使用；留空则用 DSH 默认目录'),
    clientTimeZone: Schema.string()
      .default('Asia/Shanghai')
      .description('**客户端时区**<br>IANA 名称，如 `Asia/Shanghai`'),
    replyFormat: Schema.union([
      Schema.const('text').description('纯文本'),
      Schema.const('markdown').description('保留 Markdown'),
    ])
      .default('text')
      .description('**回复格式**<br>QQ 不渲染 Markdown，默认转纯文本'),
  }).description('会话设置'),

  Schema.object({
    splitLength: Schema.natural()
      .min(0)
      .max(5000)
      .step(100)
      .default(1500)
      .description('**触发长度**<br>回复超过该字数才特殊处理；`0` 表示始终按下方规则处理'),
    chunkLength: Schema.natural()
      .min(200)
      .max(5000)
      .step(100)
      .default(1500)
      .description('**单段长度**<br>分段发送的每段、合并转发的每个节点的最大字数'),
    mergeForward: Schema.boolean()
      .default(false)
      .description('**合并转发**<br>超长回复改用合并转发，仅 OneBot 支持'),
  }).description('回复设置'),

  Schema.object({
    allowUsers: Schema.array(Schema.string())
      .role('table')
      .default([])
      .description(
        '**用户白名单**<br>' +
        '写 `平台:用户ID`（如 `onebot:123456`），也可只写用户 ID。' +
        '名单内用户在私聊和群聊都可使用；留空表示谁都不能用',
      ),
    defaultPermission: Schema.union([
      Schema.const('').description('不设置'),
      ...PERMISSION_PRESETS.map((value) => Schema.const(value).description(presetLabel(value))),
    ])
      .default('')
      .description('**新建会话权限**<br>创建会话后自动切换到的权限预设；不设置则沿用 DSH 默认'),
  }).description('权限设置'),

  Schema.object({
    enableImages: Schema.boolean()
      .default(true)
      .description('**回传图片**<br>把回复中的图片与附件转成聊天图片'),
    maxImages: Schema.natural()
      .min(0)
      .max(20)
      .default(6)
      .description('**单轮图片上限**<br>0 表示不回传图片'),
    maxImageMb: Schema.natural()
      .min(1)
      .max(64)
      .default(8)
      .description('**单张图片上限**<br>单位 MB'),
    enableFiles: Schema.boolean()
      .default(true)
      .description('**收发文件**<br>接收聊天里的文件并提交给 DSH，也可用 dsh.get 取回工作区文件'),
    maxFileMb: Schema.natural()
      .min(1)
      .max(200)
      .default(20)
      .description('**单个文件上限**<br>单位 MB'),
  }).description('附件设置'),

  Schema.object({
    debug: Schema.boolean()
      .default(false)
      .description('**调试日志**<br>输出 RPC、端口发现与未识别事件帧'),
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
    debug: config.debug ?? false,
  }
}
