export const PLUGIN_NAME = 'koishi-plugin-dsh-connector'
export const LOGGER_NAME = 'dsh-connector'

/** Markdown 图片语法，DSH 的文本回复里经常夹带图片链接 */
export const MARKDOWN_IMAGE_RE = /!\[[^\]]*\]\(([^\s)]+)(?:\s[^)]*)?\)/g
/** 附件引用的内部前缀，解析时再换成真实数据 */
export const DSH_ATTACHMENT_PREFIX = 'dsh-attachment:'

/** DSH 持久化的凭据文件名 */
export const DSH_CREDENTIALS_FILE = '.credentials.yaml'
/** 浏览器会话签名密钥在凭据文件中的记录名 */
export const DSH_BROWSER_SESSION_RECORD = 'client-connection/browser-session'
/** DSH 签名 cookie 的名称前缀、版本与有效期 */
export const DSH_AUTH_COOKIE_PREFIX = 'dsh-auth-'
export const DSH_AUTH_COOKIE_VERSION = 1
export const DSH_AUTH_COOKIE_TTL_MS = 60 * 60 * 1000
/** 未认证访问 DSH 首页时返回的指纹文本，用于端口发现 */
export const DSH_AUTH_MARK = 'dsh web authentication required'
export const DSH_BOOT_MARK = '__DSH_BOOT__'
/** relay 下发的访问 cookie 名 */
export const RELAY_ACCESS_COOKIE = 'dsh-relay-access'
/** relay 的免密入口，带 key 换取访问 cookie */
export const RELAY_LOGIN_PATH = '/?key='

export const DISCOVER_PROBE_TIMEOUT_MS = 900
export const DISCOVER_MAX_CANDIDATES = 300
export const DISCOVER_CONCURRENCY = 24

/** 支持合并转发的平台；其它平台一律降级为分段发送 */
export const FORWARD_PLATFORMS = ['onebot']

/** DSH 权限预设的中文名 */
export const PRESET_LABELS: Record<string, string> = {
  'read-only': '仅可查看',
  'workspace-write': '工作区可写',
  'danger-full-access': '完全权限',
  auto: '自动审查',
}

/** DSH 公开的权限预设；新建会话的默认值只能从这里取 */
export const PERMISSION_PRESETS = ['read-only', 'workspace-write', 'danger-full-access', 'auto']

export function presetLabel(value: string | undefined): string {
  if (!value) return '未知'
  return PRESET_LABELS[value] ?? value
}

/** DSH 思考等级的中文名 */
export const EFFORT_LABELS: Record<string, string> = {
  off: '关闭',
  low: '低',
  high: '高',
  max: '最高',
}

export function effortLabel(value: string | undefined): string {
  if (!value) return '默认'
  return EFFORT_LABELS[value] ?? value
}

/**
 * 面向用户的文案。
 *
 * 聊天平台不渲染 Markdown，也不要把内容写成 `<...>`：Koishi 会把尖括号当消息元素
 * 解析并吞掉，用户只能看到残缺的提示。
 */
export const MESSAGES = {
  noWhitelist: '插件还没配置允许的用户，请联系管理员。',
  denied: (uid: string) => `你不在允许名单中（标识：${uid}）`,

  notReady: '还没连上 DeepSeek Harness。请确认 DSH 已启动，或发 dsh.ping 查看具体原因。',

  noBinding: '当前聊天还没有绑定 DSH 会话。发 dsh.new 新建一个，或发 dsh.use 加序号绑定已有会话。',
  noPendingApproval: '当前没有等待处理的授权请求。',

  promptAccepted: '已提交到 DeepSeek Harness，正在执行……',
  busy: '这个聊天还有任务在执行，等它结束或先发 dsh.stop。',
  promptTimedOut: '等待超时，任务可能仍在 DSH 中执行。稍后可用 dsh.history 查看结果。',

  stopRequested: '已请求停止当前任务。',

  sessionCreated: '已创建并绑定新的 DSH 会话。',
  sessionMissing: '没有找到匹配的 DSH 会话，发 dsh.sessions 查看可用列表。',
  noSessions: '还没有会话，发 dsh.new 新建一个。',
  listFirst: '先发 dsh.sessions 查看列表，再用 dsh.use 加序号绑定。',
  indexOutOfRange: (count: number) => `序号超出范围，当前列表只有 ${count} 个会话。`,

  noPermissionBinding: '先绑定一个 DSH 会话，再查看或切换权限。',
  invalidPreset: (value: string, valid: string) => `无效的权限预设：${value}，可选 ${valid}。`,
  permissionChanged: (label: string) => `已切换权限：${label}`,

  approveSent: '已允许该授权请求。',
  denySent: '已拒绝该授权请求。',

  noModelBinding: '先绑定一个 DSH 会话，再查看或切换模型。',
  invalidModel: (value: string) => `没有找到模型：${value}，发 dsh.model 查看可用列表。`,
  invalidEffort: (value: string, valid: string) => `无效的思考等级：${value}，可选 ${valid}。`,
  noEffortChoice: '这个模型不支持调整思考等级。',

  noWorkspace: '还没有可用的工作区，用 dsh.new 加路径新建一个。',
  workspaceMissing: (value: string) => `没有找到工作区：${value}`,

  balanceUnavailable: '读不到账户余额：DSH 可能未登录 DeepSeek 平台账号。',
  balanceLow: (value: string, threshold: number) => `余额提醒：当前 ${value}，低于告警线 ${threshold} 元。`,

  getUsage: '用法：dsh.get 相对路径，例如 dsh.get src/index.ts。',
  fileTooLarge: (mb: number) => `文件超过 ${mb} MB 上限，没有发送。`,
  filesSkipped: (count: number) => `有 ${count} 个文件未能读取或超出上限。`,

  emptyUsage: '请提供要交给 DSH 的内容，例如：dsh.run 列出当前目录的文件',
  noContent: '已完成这一轮，但没有返回可发送的内容。',
  imagesSkipped: (count: number) => `有 ${count} 张图片未能取回或超出上限。`,
} as const

/** 端口发现失败时的可执行指引 */
export const DISCOVERY_HINT =
  '未发现本机正在运行的 DeepSeek Harness 网页服务。请先启动 DSH 桌面版；' +
  '或运行 dsh web --port 3080，再把插件配置 baseUrl 设为 http://127.0.0.1:3080'
