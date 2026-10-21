import WebSocket from 'ws'
import { callRpc } from './rpc'
import { debugLog, logger } from '../utils'

export interface WaterfallFrame {
  [key: string]: unknown
}

export interface ApprovalRequest {
  eventId: string
  sessionId?: string
  tool?: string
  reason?: string
  raw: WaterfallFrame
}

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect?: boolean
}

/** DSH 的 `user-questions/request`：agent 在回合中主动向用户提问 */
export interface QuestionRequest {
  eventId: string
  sessionId: string
  questions: QuestionItem[]
  raw: WaterfallFrame
}

export interface WorkspaceInfo {
  id: string
  path: string
  title: string
  sessionIds: string[]
}

/** DSH 的工作区基线：工作区成员关系、归档与置顶会话 */
export interface WorkspaceSnapshot {
  workspaces: WorkspaceInfo[]
  archived: string[]
  pinned: string[]
}

/** 工作区流的增量：归档/置顶都是整表替换 */
export type WorkspaceUpdate =
  | { kind: 'baseline'; snapshot: WorkspaceSnapshot }
  | { kind: 'archived'; archived: string[] }
  | { kind: 'pinned'; pinned: string[] }

export interface EventBridgeOptions {
  wsUrl: string
  baseUrl: string
  getCookie: () => Promise<string>
  onApproval: (request: ApprovalRequest) => void
  onQuestion?: (request: QuestionRequest) => void
  onWorkspace?: (update: WorkspaceUpdate) => void
  /** 是否空闲：空闲时连续失败会暂停重连，等下次使用插件再唤醒 */
  isIdle?: () => boolean
  debug: boolean
}

const EVENTS_STREAM = 'koishi-plugin-dsh'
const WORKSPACE_STREAM = 'koishi-plugin-dsh-workspace'

function readWorkspaceSnapshot(value: Record<string, unknown>): WorkspaceSnapshot | null {
  const payload = (value.value ?? value) as Record<string, unknown>
  const items = payload.items
  if (!Array.isArray(items)) return null

  const workspaces: WorkspaceInfo[] = []
  for (const item of items) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = pickString(record, ['workspaceId', 'id'])
    const path = pickString(record, ['path'])
    if (!id || !path) continue
    workspaces.push({
      id,
      path,
      title: pickString(record, ['title', 'name']) ?? path,
      sessionIds: (Array.isArray(record.sessionIds) ? record.sessionIds : []).filter(
        (sessionId): sessionId is string => typeof sessionId === 'string',
      ),
    })
  }

  const toIds = (input: unknown): string[] =>
    (Array.isArray(input) ? input : []).filter((id): id is string => typeof id === 'string')

  return {
    workspaces,
    archived: toIds(payload.archivedSessionIds),
    pinned: toIds(payload.pinnedSessionIds),
  }
}

/** 重连退避阶梯：长时间离线时降到 5 分钟一次 */
const RECONNECT_DELAYS_MS = [2000, 5000, 15000, 30000, 60000, 120000, 300000]
/** 空闲时连续失败多少次后暂停重连，等下一次使用插件时唤醒 */
const SUSPEND_AFTER_FAILURES = 5
/** 失败日志的最小间隔，避免 debug 模式下刷屏 */
const FAILURE_LOG_INTERVAL_MS = 5 * 60 * 1000
const RESULT_TIMEOUT_MS = 15000

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

function pickRecord(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  for (const key of keys) {
    const value = source[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  }
  return {}
}

/**
 * 把一帧 waterfall 识别成提问请求。
 *
 * 实测帧形如：
 * `{ type: 'waterfall', event: 'user-questions/request', eventId, agentId, request: { questions: [...] } }`
 */
export function readQuestionFrame(frame: WaterfallFrame): QuestionRequest | null {
  const label = ['endpoint', 'method', 'name', 'event', 'type']
    .map((key) => frame[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  if (!label.includes('question')) return null

  const eventId = pickString(frame, ['eventId', 'id'])
  const sessionId = pickString(frame, ['agentId', 'sessionId'])
  const request = pickRecord(frame, ['request', 'args', 'payload', 'data'])
  const rawQuestions = request.questions
  if (!eventId || !sessionId || !Array.isArray(rawQuestions)) return null

  const questions: QuestionItem[] = []
  for (const item of rawQuestions) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const id = pickString(record, ['id'])
    const question = pickString(record, ['question', 'text', 'title'])
    if (!id || !question) continue
    const options: QuestionOption[] = []
    for (const option of Array.isArray(record.options) ? record.options : []) {
      if (!option || typeof option !== 'object') continue
      const data = option as Record<string, unknown>
      const label = pickString(data, ['label', 'value', 'text'])
      if (!label) continue
      options.push({
        label,
        description: pickString(data, ['description', 'detail']),
      })
    }
    questions.push({
      id,
      question,
      header: pickString(record, ['header', 'title']),
      options,
      multiSelect: record.multiSelect === true,
    })
  }

  if (questions.length === 0) return null
  return { eventId, sessionId, questions, raw: frame }
}

/**
 * 把一帧 waterfall 识别成授权请求。
 *
 * DSH 的转发帧在文档里只承诺「带 eventId 的 approval/request」，不同版本把
 * 端点名放在 `endpoint`/`method`/`name`/`type` 中的某个字段，因此这里逐个探测，
 * 认不出来时由调用方记 debug 日志，不猜测。
 */
export function readApprovalFrame(frame: WaterfallFrame): ApprovalRequest | null {
  const eventId = pickString(frame, ['eventId', 'id', 'requestId'])
  if (!eventId) return null

  const label = ['endpoint', 'method', 'name', 'event', 'type']
    .map((key) => frame[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
  if (!label.includes('approval')) return null

  const args = pickRecord(frame, ['args', 'payload', 'request', 'data'])
  return {
    eventId,
    sessionId: pickString(args, ['sessionId', 'agentId']) ?? pickString(frame, ['sessionId', 'agentId']),
    tool: pickString(args, ['tool', 'toolName', 'name']),
    reason: pickString(args, ['reason', 'message', 'description']),
    raw: frame,
  }
}

/**
 * 维持 `/api/remote.mux` 上的 `$events` 流，并把授权结论送回去。
 *
 * HTTP 侧没有推送能力，审批请求只在这条连接上下发；断线后 DSH 会把未答复的
 * 请求重新投递给新连接，因此这里只要保证重连即可补齐。
 */
export class EventBridge {
  private socket?: WebSocket
  private retryTimer?: NodeJS.Timeout
  private closed = false
  private readyClientId?: string
  /** 退避阶梯下标 */
  private delayIndex = 0
  /** 连续失败次数，连接成功后清零 */
  private failures = 0
  /** 空闲且连续失败过多时暂停重连，等 resume() 唤醒 */
  private suspended = false
  private lastFailureLogAt = 0
  private connecting = false

  constructor(private readonly options: EventBridgeOptions) {}

  get clientId(): string | undefined {
    return this.readyClientId
  }

  get connected(): boolean {
    return this.readyClientId !== undefined
  }

  get isSuspended(): boolean {
    return this.suspended
  }

  start(): void {
    if (this.closed) return
    this.suspended = false
    this.delayIndex = 0
    void this.connect()
  }

  /** 被指令唤醒：暂停中的桥重新开始连接 */
  resume(): void {
    if (this.closed || !this.suspended) return
    this.suspended = false
    this.delayIndex = 0
    this.failures = 0
    debugLog(this.options.debug, 'mux', '收到唤醒，恢复连接')
    void this.connect()
  }

  close(): void {
    this.closed = true
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.retryTimer = undefined
    this.readyClientId = undefined

    const socket = this.socket
    this.socket = undefined
    if (!socket) return
    socket.removeAllListeners()
    // 握手还没完成时 close() 会抛错，这种情况直接终止连接
    if (socket.readyState === WebSocket.CONNECTING) socket.terminate()
    else socket.close()
  }

  private scheduleReconnect(): void {
    if (this.closed || this.retryTimer) return
    const delay = RECONNECT_DELAYS_MS[Math.min(this.delayIndex, RECONNECT_DELAYS_MS.length - 1)]
    this.delayIndex += 1
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, delay)
  }

  /** 失败日志只在首次、或距上次超过 5 分钟时输出 */
  private shouldLogFailure(): boolean {
    const now = Date.now()
    if (this.failures <= 1 || now - this.lastFailureLogAt >= FAILURE_LOG_INTERVAL_MS) {
      this.lastFailureLogAt = now
      return true
    }
    return false
  }

  /** 连接失败后的统一处理：记录次数，空闲时暂停，否则退避重试 */
  private handleFailure(reason: string): void {
    this.failures += 1
    const idle = this.options.isIdle?.() ?? true
    if (idle && this.failures >= SUSPEND_AFTER_FAILURES) {
      this.suspended = true
      if (this.shouldLogFailure()) {
        debugLog(
          this.options.debug,
          'mux',
          `连续失败 ${this.failures} 次（${reason}），已暂停重连；下次使用插件时自动恢复`,
        )
      }
      return
    }
    if (this.shouldLogFailure()) {
      const delay = RECONNECT_DELAYS_MS[Math.min(this.delayIndex, RECONNECT_DELAYS_MS.length - 1)]
      debugLog(
        this.options.debug,
        'mux',
        `第 ${this.failures} 次失败（${reason}），${Math.round(delay / 1000)} 秒后重试`,
      )
    }
    this.scheduleReconnect()
  }

  private async connect(): Promise<void> {
    if (this.closed || this.connecting || this.socket || this.retryTimer) return
    this.connecting = true
    try {
      await this.openSocket()
    } finally {
      this.connecting = false
    }
  }

  private async openSocket(): Promise<void> {
    debugLog(this.options.debug, 'mux', `连接 ${this.options.wsUrl}`)

    let cookie: string
    try {
      cookie = await this.options.getCookie()
    } catch (error) {
      // 凭据暂时取不到（DSH 未就绪等），退避后重试，不影响插件其它能力
      this.handleFailure(`凭据不可用: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    if (this.closed) return

    let socket: WebSocket
    try {
      socket = new WebSocket(this.options.wsUrl, {
        headers: { cookie, origin: this.options.baseUrl },
      })
    } catch (error) {
      // 地址非法等构造期错误：退避重试，不要把异常抛给上层
      this.handleFailure(`建立连接失败: ${error instanceof Error ? error.message : String(error)}`)
      return
    }
    this.socket = socket

    socket.on('open', () => {
      debugLog(this.options.debug, 'mux', '已连接，订阅 $events 与 workspace/follow')
      this.failures = 0
      this.delayIndex = 0
      this.suspended = false
      socket.send(JSON.stringify({
        type: 'open',
        streamId: EVENTS_STREAM,
        endpoint: '$events',
        payload: { args: {} },
      }))
      // 工作区基线：分组、归档与排序都以它为准
      socket.send(JSON.stringify({
        type: 'open',
        streamId: WORKSPACE_STREAM,
        endpoint: 'workspace/follow',
        payload: { args: {} },
      }))
    })

    socket.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (error: Error) => {
      // 具体错误由 close 统一处理，这里只在调试时记录
      debugLog(this.options.debug, 'mux', `连接错误: ${error.message}`)
    })

    socket.on('close', () => {
      this.readyClientId = undefined
      this.socket = undefined
      if (this.closed) return
      this.handleFailure('连接被关闭')
    })
  }

  private handleMessage(text: string): void {
    let frame: Record<string, unknown>
    try {
      frame = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (frame.type !== 'item') return

    const value = frame.value
    if (!value || typeof value !== 'object' || Array.isArray(value)) return
    const payload = value as WaterfallFrame

    // 工作区流：基线/整包替换覆盖快照，归档与置顶是整表替换
    if (frame.streamId === WORKSPACE_STREAM) {
      const type = payload.type
      const toIds = (input: unknown): string[] =>
        (Array.isArray(input) ? input : []).filter((id): id is string => typeof id === 'string')

      if (type === 'baseline' || type === 'replace') {
        const snapshot = readWorkspaceSnapshot(payload)
        if (snapshot) {
          debugLog(
            this.options.debug,
            'workspace',
            `基线：${snapshot.workspaces.length} 个工作区，${snapshot.archived.length} 个归档`,
          )
          this.options.onWorkspace?.({ kind: 'baseline', snapshot })
        }
      } else if (type === 'archived') {
        this.options.onWorkspace?.({ kind: 'archived', archived: toIds(payload.archivedSessionIds) })
      } else if (type === 'pinned') {
        this.options.onWorkspace?.({ kind: 'pinned', pinned: toIds(payload.pinnedSessionIds) })
      } else if (this.options.debug) {
        logger.debug(`[mux] 未处理的工作区帧: ${text.slice(0, 300)}`)
      }
      return
    }

    if (payload.type === 'ready') {
      const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
      this.readyClientId = clientId || undefined
      debugLog(this.options.debug, 'mux', `事件桥就绪 clientId=${clientId || '无'}`)
      return
    }

    const question = readQuestionFrame(payload)
    if (question) {
      debugLog(
        this.options.debug,
        'question',
        `收到提问 ${question.questions.length} 个 session=${question.sessionId} callId=${question.eventId}`,
      )
      this.options.onQuestion?.(question)
      return
    }

    const approval = readApprovalFrame(payload)
    if (approval) {
      debugLog(
        this.options.debug,
        'approval',
        `收到授权请求 tool=${approval.tool ?? '未知'} session=${approval.sessionId ?? '未知'} event=${approval.eventId}`,
      )
      this.options.onApproval(approval)
      return
    }

    debugLog(this.options.debug, 'mux', `未识别的事件帧: ${text.slice(0, 400)}`)
  }

  /** 把授权结论回送给 DSH，`value` 由调用方按 DSH 的 outcome 词表给出 */
  async answer(eventId: string, value: string): Promise<void> {
    const clientId = this.readyClientId
    if (!clientId) throw new Error('事件桥尚未就绪，无法回送授权结果')
    await callRpc({
      baseUrl: this.options.baseUrl,
      cookie: await this.options.getCookie(),
      method: '$events/result',
      args: { clientId, eventId, outcome: { kind: 'result', value } },
      timeoutMs: RESULT_TIMEOUT_MS,
    })
  }
}
