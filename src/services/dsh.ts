import { randomUUID } from 'node:crypto'
import { DISCOVERY_HINT, DSH_ATTACHMENT_PREFIX } from '../constants'
import type { Config } from '../config'
import {
  DshAuthError,
  buildAuthCookie,
  loginRelay,
  readBrowserSessionSecret,
  resolveDshHome,
} from '../core/auth'
import { discoverDshPort } from '../core/discover'
import { decodeAttachment, extractContent, fetchImage, type TurnImage } from '../core/media'
import {
  EventBridge,
  type ApprovalRequest,
  type QuestionRequest,
  type WorkspaceSnapshot,
} from '../core/mux'
import { DshRpcError, callRpc, callRpcMultipart } from '../core/rpc'
import { logger, normalizeTimeZone, sleep } from '../utils'
import { diffUsage, EMPTY_USAGE, type TokenUsage } from '../core/pricing'

const AUTH_TIMEOUT_MS = 15000
const RPC_TIMEOUT_MS = 30000
const IMAGE_TIMEOUT_MS = 15000
const PAGE_SIZE = 100
/** 授权队列上限：请求可能在 DSH 界面被取消而收不到结果，不设上限会一直堆积 */
const MAX_PENDING_APPROVALS = 50

export type ApprovalDecision = 'allow' | 'deny'

export interface DshSessionSummary {
  sessionId: string
  title: string
  running: boolean
  /** 子会话（子代理）不出现在普通列表里 */
  parentSessionId?: string
  cwd?: string
  /** 还没跑过任何一轮的空会话 */
  blank: boolean
  /** 最后修改时间（毫秒），列表按它倒序 */
  updatedAt: number
}

export interface SessionListOptions {
  includeChildren?: boolean
  includeBlank?: boolean
}

/** 聊天里收到的文件，上传到 DSH 后换成凭据再提交 */
export interface TurnFile {
  receiptId: string
  name: string
}

/** DSH 可路由的模型，按 provider 分组展开 */
export interface DshModelOption {
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

export interface DshModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface DshModelCatalog {
  models: DshModelOption[]
  /** 部署默认选择，新会话尚未指定模型时用它兜底 */
  defaultSelection?: DshModelSelection
}

export interface DshWorkspaceEntry {
  name: string
  type: string
  size?: number
}

export interface BalanceWallet {
  currency: string
  balance: number
}

export interface BalanceInfo {
  /** 充值余额 */
  wallets: BalanceWallet[]
  /** 赠送余额 */
  bonusWallets: BalanceWallet[]
}

export interface TurnResult {
  text: string
  images: TurnImage[]
  /** 未能取回或超出上限的图片数量，用于如实告知用户 */
  skipped: number
  seq: number
  /** 本轮消耗的 token（快照相减） */
  usage: TokenUsage
  /** 本轮实际使用的模型，用于估算费用 */
  model?: string
}

interface SequencedEvent {
  seq: number
  event: Record<string, unknown>
}

/** 等待超时时带上已经看到的最后一段回复，避免整段丢弃 */
export class DshTurnTimeout extends Error {
  constructor(
    readonly partial: string,
    readonly baseline = 0,
  ) {
    super('等待 DSH 回复超时')
    this.name = 'DshTurnTimeout'
  }
}

function toModelSelection(raw: unknown): DshModelSelection | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const value = raw as Record<string, unknown>
  const provider = typeof value.provider === 'string' ? value.provider : ''
  const model = typeof value.model === 'string' ? value.model : ''
  if (!provider || !model) return undefined
  return {
    provider,
    model,
    reasoningEffort: typeof value.reasoningEffort === 'string' ? value.reasoningEffort : undefined,
  }
}

function toSummary(row: unknown): DshSessionSummary | null {
  if (!row || typeof row !== 'object') return null
  const record = row as Record<string, unknown>
  const sessionId = typeof record.sessionId === 'string' ? record.sessionId : ''
  if (!sessionId) return null
  const projections = (record.projections ?? {}) as Record<string, unknown>
  const values = (projections.values ?? {}) as Record<string, unknown>
  return {
    sessionId,
    title: typeof values.title === 'string' ? values.title : '',
    running: Boolean(record.running),
    parentSessionId: typeof record.parentSessionId === 'string' ? record.parentSessionId : undefined,
    cwd: typeof record.cwd === 'string' && record.cwd ? record.cwd : undefined,
    blank: Boolean(record.blank),
    updatedAt: Number.isFinite(Number(record.updatedAt)) ? Number(record.updatedAt) : 0,
  }
}

function parseBaseUrl(raw: string): string {
  const text = raw.trim().replace(/\/+$/, '')
  try {
    const url = new URL(text)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('unsupported protocol')
    return text
  } catch {
    throw new DshAuthError(`配置项 \`baseUrl\` 不是合法的 HTTP 地址: ${raw}`)
  }
}

/** 从 `assistant/message` 事件里取出文本块 */
export function extractEventText(event: unknown): string {
  if (!event || typeof event !== 'object') return ''
  const data = ((event as Record<string, unknown>).data ?? {}) as Record<string, unknown>
  const message = (data.message ?? {}) as Record<string, unknown>
  const raw = message.content ?? data.content ?? []
  const blocks = Array.isArray(raw) ? raw : [raw]
  const parts: string[] = []
  for (const block of blocks) {
    if (!block || typeof block !== 'object') continue
    const item = block as Record<string, unknown>
    if ((item.type === 'text' || item.type === 'markdown') && typeof item.text === 'string') {
      parts.push(item.text)
    }
  }
  return parts.join('')
}

/**
 * DSH 客户端：负责定位端口、取得 cookie、维护审批事件桥，并提供会话级操作。
 *
 * 直连与 relay 只差「cookie 从哪来」，其余 RPC 与事件桥完全一致。
 */
export class DshClient {
  private baseUrl?: string
  private cookie?: string
  private secret?: Buffer
  private authority?: string
  private preferredPort?: number
  private connecting?: Promise<void>
  private bridge?: EventBridge
  private readonly pending: ApprovalRequest[] = []
  private approvalHandler?: (request: ApprovalRequest) => void
  private questionHandler?: (request: QuestionRequest) => void
  /** 工作区流的最新快照，未收到前为 undefined */
  private workspace?: WorkspaceSnapshot

  constructor(private readonly config: Config) {}

  get relayMode(): boolean {
    return this.config.mode === 'relay' || (this.config.mode === 'auto' && this.config.accessKey !== '')
  }

  get connected(): boolean {
    return this.baseUrl !== undefined && this.cookie !== undefined
  }

  describe(): { mode: string; baseUrl?: string; bridge: boolean } {
    return {
      mode: this.relayMode ? 'relay' : 'direct',
      baseUrl: this.baseUrl,
      bridge: this.bridge?.connected ?? false,
    }
  }

  async ensureReady(): Promise<void> {
    if (this.baseUrl && this.cookie) return
    if (!this.connecting) {
      this.connecting = this.connect().finally(() => {
        this.connecting = undefined
      })
    }
    await this.connecting
  }

  private async connect(): Promise<void> {
    if (this.relayMode) {
      if (!this.config.baseUrl) {
        throw new DshAuthError('relay 模式需要填写配置项 `baseUrl`，例如 `http://192.168.192.100`。')
      }
      const baseUrl = parseBaseUrl(this.config.baseUrl)
      const cookie = await loginRelay(baseUrl, this.config.accessKey, AUTH_TIMEOUT_MS)
      this.baseUrl = baseUrl
      this.cookie = cookie
      this.authority = new URL(baseUrl).host
    } else {
      const home = resolveDshHome(this.config.dshHome)
      this.secret = await readBrowserSessionSecret(home)
      let baseUrl = this.config.baseUrl
      if (!baseUrl) {
        const port = await discoverDshPort(this.preferredPort)
        if (port === undefined) throw new DshAuthError(DISCOVERY_HINT)
        this.preferredPort = port
        baseUrl = `http://127.0.0.1:${port}`
      }
      const resolved = parseBaseUrl(baseUrl)
      const authority = new URL(resolved).host
      const cookie = buildAuthCookie(this.secret, authority)
      this.baseUrl = resolved
      this.authority = authority
      this.cookie = cookie
    }

    logger.debug(`[client] 已连接 ${this.baseUrl} (${this.relayMode ? 'relay' : 'direct'})`)
    this.startBridge()
  }

  /** DSH 重启会换端口与密钥，这里丢弃连接状态，保留上次端口作为首选探测目标 */
  private invalidate(): void {
    this.baseUrl = undefined
    this.cookie = undefined
    this.bridge?.close()
    this.bridge = undefined
  }

  private async refreshCookie(): Promise<string> {
    if (this.relayMode) {
      const baseUrl = this.baseUrl ?? this.config.baseUrl
      if (!baseUrl) throw new DshAuthError('relay 模式需要填写配置项 `baseUrl`')
      this.cookie = await loginRelay(baseUrl, this.config.accessKey, AUTH_TIMEOUT_MS)
      return this.cookie
    }

    const secret = await readBrowserSessionSecret(resolveDshHome(this.config.dshHome))
    this.secret = secret
    if (!this.baseUrl) await this.ensureReady()
    if (!this.baseUrl) throw new DshAuthError('DSH 地址尚未确定')
    this.authority = new URL(this.baseUrl).host
    this.cookie = buildAuthCookie(secret, this.authority)
    return this.cookie
  }

  private async getCookieForBridge(): Promise<string> {
    await this.ensureReady()
    if (!this.cookie) throw new DshAuthError('DSH 凭据尚未就绪')
    return this.cookie
  }

  private startBridge(): void {
    if (this.bridge || !this.baseUrl) return
    const baseUrl = this.baseUrl
    this.bridge = new EventBridge({
      wsUrl: `${baseUrl.replace(/^http/, 'ws')}/api/remote.mux`,
      baseUrl,
      debug: this.config.debug,
      getCookie: () => this.getCookieForBridge(),
      onApproval: (request) => {
        this.pending.push(request)
        // 授权请求可能被 DSH 界面取消而永远收不到结论，限制队列长度避免无限增长
        if (this.pending.length > MAX_PENDING_APPROVALS) this.pending.shift()
        this.approvalHandler?.(request)
      },
      onQuestion: (request) => {
        this.questionHandler?.(request)
      },
      onWorkspace: (snapshot) => {
        this.workspace = snapshot
      },
    })
    this.bridge.start()
  }

  private async rawRpc(method: string, args: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    if (!this.baseUrl || !this.cookie) throw new DshAuthError('DSH 连接尚未就绪')
    return callRpc({ baseUrl: this.baseUrl, cookie: this.cookie, method, args, timeoutMs })
  }

  /** 结果带二进制的接口走 multipart，重试策略与普通 RPC 一致 */
  private async rpcMultipart(
    method: string,
    args: Record<string, unknown>,
    timeoutMs = RPC_TIMEOUT_MS,
  ): Promise<{ value: unknown; parts: Map<string, Buffer> }> {
    await this.ensureReady()
    const run = async () => {
      if (!this.baseUrl || !this.cookie) throw new DshAuthError('DSH 连接尚未就绪')
      return callRpcMultipart({ baseUrl: this.baseUrl, cookie: this.cookie, method, args, timeoutMs })
    }
    try {
      return await run()
    } catch (error) {
      if (!(error instanceof DshRpcError)) throw error
      if (error.code === 'unauthorized') {
        await this.refreshCookie()
        return run()
      }
      if (error.code === 'network') {
        this.invalidate()
        await this.ensureReady()
        return run()
      }
      throw error
    }
  }

  async rpc(method: string, args: Record<string, unknown> = {}, timeoutMs = RPC_TIMEOUT_MS): Promise<unknown> {
    await this.ensureReady()
    try {
      return await this.rawRpc(method, args, timeoutMs)
    } catch (error) {
      if (!(error instanceof DshRpcError)) throw error
      // cookie 过期就重签一次；网络中断多半是 DSH 重启换了端口，重新发现后再试
      if (error.code === 'unauthorized') {
        await this.refreshCookie()
        return this.rawRpc(method, args, timeoutMs)
      }
      if (error.code === 'network') {
        this.invalidate()
        await this.ensureReady()
        return this.rawRpc(method, args, timeoutMs)
      }
      throw error
    }
  }

  /**
   * 会话列表，按最后修改时间倒序。
   *
   * `session/list` 会同时返回子代理会话与从未使用过的空会话，两者都不该出现在
   * 用户可见的列表里：子会话的标题其实是子代理的提示词，空会话则没有内容。
   * 排序放在这里，保证所有调用方（列表、绑定、状态）看到的是同一个顺序。
   */
  async listSessions(options: SessionListOptions = {}): Promise<DshSessionSummary[]> {
    const value = (await this.rpc('session/list', { _request: {} })) as { items?: unknown[] }
    return (value.items ?? [])
      .map(toSummary)
      .filter((item): item is DshSessionSummary => item !== null)
      .filter((item) => {
        if (!options.includeChildren && item.parentSessionId) return false
        if (!options.includeBlank && item.blank) return false
        return true
      })
      .sort((left, right) => right.updatedAt - left.updatedAt)
  }

  async createSession(cwd?: string): Promise<string> {
    const request: Record<string, unknown> = {}
    if (cwd) request.cwd = cwd
    const value = (await this.rpc('session/create', { request })) as { sessionId?: string }
    const sessionId = value.sessionId
    if (!sessionId) throw new Error('DSH 没有返回会话 ID')
    await this.applyDefaultPermission(sessionId)
    return sessionId
  }

  /** 新建会话按配置切到默认权限；失败只记日志，不阻断会话创建 */
  private async applyDefaultPermission(sessionId: string): Promise<void> {
    const preset = this.config.defaultPermission
    if (!preset) return
    try {
      await this.setPermission(sessionId, preset)
      logger.debug(`[session] 新会话权限已设为 ${preset}`)
    } catch (error) {
      logger.warn(`[session] 新会话权限设置失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async sessionTitle(sessionId: string): Promise<string> {
    const sessions = await this.listSessions()
    return sessions.find((item) => item.sessionId === sessionId)?.title ?? ''
  }

  /** 权限预设目录，由 DSH 官方插件 `dsh-permission-presets` 提供 */
  async permissionPresets(): Promise<string[]> {
    const value = (await this.rpc('permissionPresets/catalog', {})) as {
      options?: Array<{ value?: unknown }>
    }
    return (value.options ?? []).map((option) => String(option?.value ?? '')).filter(Boolean)
  }

  /** 会话当前生效的权限预设 */
  async currentPermission(sessionId: string): Promise<string | undefined> {
    return (await this.sessionSnapshot(sessionId)).permission
  }

  /** 一次 projections 取回状态面板需要的字段 */
  async sessionSnapshot(
    sessionId: string,
  ): Promise<{ permission?: string; model?: DshModelSelection }> {
    const value = (await this.rpc('session/projections', { request: { sessionId } })) as {
      values?: Record<string, unknown>
    }
    const values = (value.values ?? {}) as Record<string, unknown>
    const permissions = values.permissions as Record<string, unknown> | undefined
    const selection = values.modelSelection as Record<string, unknown> | undefined
    return {
      permission:
        typeof permissions?.currentValue === 'string' ? permissions.currentValue : undefined,
      model: toModelSelection(selection?.next ?? selection?.lastUsed),
    }
  }

  /** 切权限没有独立 RPC，走官方 `/permission` 斜杠命令 */
  async setPermission(sessionId: string, preset: string): Promise<void> {
    const value = (await this.rpc('commands/execute', {
      agentId: sessionId,
      line: `/permission ${preset}`,
      submittedAttachments: [],
    })) as { result?: { kind?: string; text?: string } }
    if (value?.result?.kind !== 'success') {
      throw new Error(String(value?.result?.text ?? '切换权限失败'))
    }
  }

  /** 全部可路由模型，按 provider 分组展开成一维；附带部署默认选择 */
  async modelCatalog(): Promise<DshModelCatalog> {
    const value = (await this.rpc('session/modelCatalog', {})) as {
      default?: Record<string, unknown>
      groups?: Array<{ id?: string; name?: string; models?: Array<Record<string, unknown>> }>
    }
    const options: DshModelOption[] = []
    for (const group of value.groups ?? []) {
      const provider = String(group.id ?? '')
      const providerName = String(group.name ?? group.id ?? '')
      for (const model of group.models ?? []) {
        const reasoning = (model.reasoning ?? {}) as Record<string, unknown>
        options.push({
          provider,
          providerName,
          model: String(model.id ?? ''),
          name: String(model.name ?? model.id ?? ''),
          description: typeof model.description === 'string' ? model.description : undefined,
          efforts: Array.isArray(reasoning.efforts)
            ? (reasoning.efforts as Array<Record<string, unknown>>).map((item) => ({
                id: String(item.id ?? ''),
                name: String(item.name ?? item.id ?? ''),
                description: typeof item.description === 'string' ? item.description : undefined,
              }))
            : [],
          defaultEffort: typeof reasoning.defaultEffort === 'string' ? reasoning.defaultEffort : undefined,
        })
      }
    }
    return { models: options, defaultSelection: toModelSelection(value.default) }
  }

  /** 会话当前生效的模型与思考等级；`next` 是下一次生效的选择 */
  async modelSelection(sessionId: string): Promise<DshModelSelection | undefined> {
    const value = (await this.rpc('session/projections', { request: { sessionId } })) as {
      values?: Record<string, unknown>
    }
    const selection = ((value.values ?? {}) as Record<string, unknown>).modelSelection as
      | Record<string, unknown>
      | undefined
    return toModelSelection(selection?.next ?? selection?.lastUsed)
  }

  async selectModel(
    sessionId: string,
    provider: string,
    model: string,
    reasoningEffort?: string,
  ): Promise<void> {
    const request: Record<string, unknown> = { sessionId, provider, model }
    if (reasoningEffort) request.reasoningEffort = reasoningEffort
    await this.rpc('session/selectModel', { request })
  }

  /** 把聊天里的文件上传到会话，返回可直接放进 prompt 的凭据 */
  async uploadFile(sessionId: string, name: string, mediaType: string, buffer: Buffer): Promise<string> {
    const value = (await this.rpc('fileUploads/upload', {
      agentId: sessionId,
      request: { name, mediaType, data: buffer.toString('base64') },
    })) as { receiptId?: string }
    if (!value?.receiptId) throw new Error('DSH 没有返回文件凭据')
    return value.receiptId
  }

  /** 列会话工作区里的目录内容 */
  async listWorkspace(sessionId: string, path: string): Promise<DshWorkspaceEntry[]> {
    const value = (await this.rpc('workspaceFiles/list', {
      workspaceFileScopeId: sessionId,
      path,
    })) as { entries?: Array<Record<string, unknown>> }
    return (value.entries ?? []).map((entry) => ({
      name: String(entry.name ?? ''),
      type: String(entry.type ?? 'file'),
      size: Number.isFinite(Number(entry.size)) ? Number(entry.size) : undefined,
    }))
  }

  /** 读会话工作区里的一个文件；超出上限时报错而不是截断 */
  async readWorkspaceFile(
    sessionId: string,
    path: string,
    maxBytes: number,
  ): Promise<{ name: string; buffer: Buffer; bytes: number }> {
    const { value, parts } = await this.rpcMultipart('workspaceFiles/readBytes', {
      workspaceFileScopeId: sessionId,
      path,
      options: { range: { offset: 0, length: maxBytes + 1 } },
    })

    const buffer = parts.get('bytes-0')
    if (!buffer) throw new Error('DSH 没有返回文件内容')
    if (buffer.length > maxBytes) throw new Error(`文件超过 ${Math.round(maxBytes / 1024 / 1024)} MB 上限`)

    const meta = (value ?? {}) as Record<string, unknown>
    const absolute = typeof meta.absolutePath === 'string' ? meta.absolutePath : path
    const name = absolute.split(/[\\/]/).filter(Boolean).pop() ?? 'file'
    return { name, buffer, bytes: buffer.length }
  }

  async cursor(sessionId: string): Promise<number> {
    const value = (await this.rpc('session/projections', { request: { sessionId } })) as { asOfSeq?: number }
    const cursor = Number(value.asOfSeq ?? 0)
    return Number.isFinite(cursor) ? cursor : 0
  }

  async page(sessionId: string, throughSeq: number, maxMessages = PAGE_SIZE): Promise<unknown[]> {
    const value = (await this.rpc('session/page', {
      request: {
        address: { kind: 'session', sessionId },
        throughSeq,
        maxMessages,
      },
    })) as { records?: unknown[] }
    return value.records ?? []
  }

  async prompt(
    sessionId: string,
    text: string,
    images: TurnImage[] = [],
    files: TurnFile[] = [],
  ): Promise<void> {
    const content: Array<Record<string, unknown>> = []
    if (text) content.push({ type: 'text', text })
    // DSH 的图片块直接接受内联 base64，不需要先上传
    for (const image of images) {
      content.push({ type: 'image', data: image.buffer.toString('base64'), mediaType: image.type })
    }
    // 文件必须先走 fileUploads/upload 换凭据
    for (const file of files) {
      content.push({ type: 'file', receiptId: file.receiptId })
    }
    await this.rpc('session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId,
        mode: 'queue',
        content,
        clientTimeZone: normalizeTimeZone(this.config.clientTimeZone),
      },
    })
  }

  async cancel(sessionId: string): Promise<void> {
    await this.rpc('session/cancel', { request: { sessionId } })
  }

  async history(sessionId: string, limit: number): Promise<string[]> {
    const cursor = await this.cursor(sessionId)
    if (cursor <= 0) return []
    const events = await this.pageEvents(sessionId, cursor, 0)
    const messages: string[] = []
    for (const item of events) {
      if (item.event.type !== 'assistant/message') continue
      const text = extractEventText(item.event).trim()
      if (text) messages.push(text)
    }
    return messages.slice(-limit)
  }

  /** 取出 `baseline` 之后的事件，按 seq 升序排列；分页返回的顺序不作假设 */
  private async pageEvents(sessionId: string, throughSeq: number, baseline: number): Promise<SequencedEvent[]> {
    const records = await this.page(sessionId, throughSeq)
    const events: SequencedEvent[] = []
    for (const entry of records) {
      const event = (entry as { event?: unknown } | null)?.event
      if (!event || typeof event !== 'object') continue
      const record = event as Record<string, unknown>
      const seq = Number(record.seq ?? 0)
      if (!Number.isFinite(seq) || seq <= baseline) continue
      events.push({ seq, event: record })
    }
    return events.sort((left, right) => left.seq - right.seq)
  }

  /** 提交一轮任务并等待 `turn/end`，中间步骤的 assistant 消息不并入最终结果 */
  async runTurn(
    sessionId: string,
    text: string,
    images: TurnImage[] = [],
    files: TurnFile[] = [],
  ): Promise<TurnResult> {
    const baseline = await this.cursor(sessionId)
    const usageBefore = await this.tokenUsage(sessionId)
    const model = await this.currentModelName(sessionId)

    await this.prompt(sessionId, text, images, files)
    const base = await this.awaitTurn(sessionId, baseline)
    const usageAfter = await this.tokenUsage(sessionId)
    return { ...base, usage: diffUsage(usageAfter, usageBefore), model }
  }

  /** 会话当前模型 ID；没有选择时用部署默认值 */
  private async currentModelName(sessionId: string): Promise<string | undefined> {
    const selection = await this.modelSelection(sessionId)
    if (selection) return selection.model
    const catalog = await this.modelCatalog().catch(() => undefined)
    return catalog?.defaultSelection?.model
  }

  /** 会话累计的 token 用量 */
  async tokenUsage(sessionId: string): Promise<TokenUsage> {
    const value = (await this.rpc('session/projections', { request: { sessionId } })) as {
      values?: Record<string, unknown>
    }
    const usage = ((value.values ?? {}) as Record<string, unknown>).tokenUsage as
      | Record<string, unknown>
      | undefined
    return {
      uncachedInputTokens: Number(usage?.uncachedInputTokens ?? 0),
      outputTokens: Number(usage?.outputTokens ?? 0),
      cacheReadTokens: Number(usage?.cacheReadTokens ?? 0),
      cacheWriteTokens: Number(usage?.cacheWriteTokens ?? 0),
    }
  }

  /** 账户余额；未登录平台账号时返回 undefined */
  async accountBalance(): Promise<BalanceInfo | undefined> {
    const value = (await this.rpc('account/getBalance', {
      client: {
        version: '0.2.0',
        locale: 'zh-CN',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      },
    })) as {
      status?: string
      value?: Array<{ currency?: string; balance?: string }>
      bonusWallets?: Array<{ currency?: string; balance?: string }>
    } | null

    if (!value || value.status !== 'ready') return undefined

    const toWallet = (item: { currency?: string; balance?: string }) => ({
      currency: String(item.currency ?? 'CNY'),
      balance: Number(item.balance ?? 0),
    })
    return {
      wallets: (value.value ?? []).map(toWallet),
      bonusWallets: (value.bonusWallets ?? []).map(toWallet),
    }
  }

  async awaitTurn(
    sessionId: string,
    baseline: number,
    timeoutMs = this.config.promptTimeout * 1000,
  ): Promise<Omit<TurnResult, 'usage' | 'model'>> {
    const deadline = Date.now() + timeoutMs
    let lastSeen = ''
    let lastCursor = baseline

    while (Date.now() < deadline) {
      const cursor = await this.cursor(sessionId)
      // 游标没动就不用再翻页：空闲期每次轮询只花一次 RPC
      if (cursor > baseline && cursor !== lastCursor) {
        lastCursor = cursor
        const events = await this.pageEvents(sessionId, cursor, baseline)

        for (const item of events) {
          if (item.event.type !== 'assistant/message') continue
          const candidate = extractEventText(item.event).trim()
          if (candidate) lastSeen = candidate
        }

        // 一轮里每条工具步骤都会产出一条 assistant/message，只有 turn/end 才算结束
        const end = [...events].reverse().find((item) => item.event.type === 'turn/end')
        if (end) {
          const data = (end.event.data ?? {}) as Record<string, unknown>
          const reason = (data.reason ?? {}) as Record<string, unknown>
          if (reason.kind === 'error') {
            const error = (reason.error ?? {}) as Record<string, unknown>
            throw new Error(`DSH 任务失败: ${String(error.message ?? error.code ?? '未知错误')}`)
          }

          let text = ''
          const refs: string[] = []
          for (const item of events) {
            if (item.seq >= end.seq) break
            if (item.event.type !== 'assistant/message') continue
            const content = extractContent(item.event)
            if (content.text.trim()) text = content.text.trim()
            for (const ref of content.images) {
              if (!refs.includes(ref)) refs.push(ref)
            }
          }
          const resolved = await this.resolveImages(sessionId, refs)
          return { text: text || lastSeen, images: resolved.images, skipped: resolved.skipped, seq: cursor }
        }
      }
      await sleep(this.config.pollInterval)
    }

    throw new DshTurnTimeout(lastSeen, baseline)
  }

  /** 把图片引用换成可以直接发送的数据；失败的只计数，不阻断文本回传 */
  private async resolveImages(sessionId: string, refs: string[]): Promise<{ images: TurnImage[]; skipped: number }> {
    if (refs.length === 0) return { images: [], skipped: 0 }
    if (!this.config.enableImages) return { images: [], skipped: refs.length }

    const maxBytes = this.config.maxImageMb * 1024 * 1024
    const images: TurnImage[] = []
    let skipped = 0

    for (const ref of refs) {
      if (images.length >= this.config.maxImages) {
        skipped += 1
        continue
      }
      const image = ref.startsWith(DSH_ATTACHMENT_PREFIX)
        ? await this.readAttachment(sessionId, ref.slice(DSH_ATTACHMENT_PREFIX.length))
        : await fetchImage(ref, maxBytes, IMAGE_TIMEOUT_MS)
      if (!image || image.buffer.length > maxBytes) {
        skipped += 1
        continue
      }
      images.push(image)
    }
    return { images, skipped }
  }

  private async readAttachment(sessionId: string, attachmentId: string): Promise<TurnImage | null> {
    try {
      const value = (await this.rpc('session/attachment', {
        request: { sessionId, attachmentId },
      })) as { attachment?: { mediaType?: string }; data?: string }
      const mediaType = String(value.attachment?.mediaType ?? 'image/png')
      return decodeAttachment(String(value.data ?? ''), mediaType)
    } catch (error) {
      logger.debug(`[media] 读取附件失败 ${attachmentId}: ${error instanceof Error ? error.message : String(error)}`)
      return null
    }
  }

  setApprovalHandler(handler: (request: ApprovalRequest) => void): void {
    this.approvalHandler = handler
  }

  setQuestionHandler(handler: (request: QuestionRequest) => void): void {
    this.questionHandler = handler
  }

  /** 最近一次工作区快照（分组、归档、排序用） */
  get workspaceSnapshot(): WorkspaceSnapshot | undefined {
    return this.workspace
  }

  /** 回答 agent 的提问；`callId` 用事件帧里的 eventId */
  async answerQuestion(
    sessionId: string,
    callId: string,
    answers: Array<{ id: string; selected: string[]; custom?: string }>,
  ): Promise<void> {
    await this.rpc('userQuestions/answer', {
      agentId: sessionId,
      callId,
      answer: { answers },
    })
  }

  /** 把补充指令注入正在运行的回合 */
  async steer(sessionId: string, text: string): Promise<void> {
    await this.rpc('session/prompt', {
      request: {
        requestId: randomUUID(),
        sessionId,
        mode: 'steer',
        content: [{ type: 'text', text }],
        clientTimeZone: normalizeTimeZone(this.config.clientTimeZone),
      },
    })
  }

  /** 执行会话级斜杠命令（/compact、/permission 等） */
  async runCommand(sessionId: string, line: string): Promise<{ kind: string; text: string }> {
    const value = (await this.rpc('commands/execute', {
      agentId: sessionId,
      line,
      submittedAttachments: [],
    })) as { result?: { kind?: string; text?: string } }
    return {
      kind: String(value?.result?.kind ?? 'unknown'),
      text: String(value?.result?.text ?? ''),
    }
  }

  listPendingApprovals(sessionId?: string): ApprovalRequest[] {
    return this.pending.filter((item) => !sessionId || !item.sessionId || item.sessionId === sessionId)
  }

  async answerApproval(decision: ApprovalDecision, sessionId?: string): Promise<ApprovalRequest | undefined> {
    const target = this.listPendingApprovals(sessionId).at(-1)
    if (!target) return undefined
    if (!this.bridge) throw new Error('审批事件桥尚未就绪，请稍后重试')
    await this.bridge.answer(target.eventId, decision)
    const index = this.pending.indexOf(target)
    if (index >= 0) this.pending.splice(index, 1)
    return target
  }

  dispose(): void {
    this.bridge?.close()
    this.bridge = undefined
    this.pending.length = 0
    this.approvalHandler = undefined
  }
}
