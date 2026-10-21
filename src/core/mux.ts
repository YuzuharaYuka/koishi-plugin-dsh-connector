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
  debug: boolean
}

const EVENTS_STREAM = 'koishi-plugin-dsh'
const WORKSPACE_STREAM = 'koishi-plugin-dsh-workspace'

function readWorkspaceSnapshot(value: Record<string, unknown>): WorkspaceSnapshot | null {  const payload = (value.value ?? value) as Record<string, unknown>
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

const RECONNECT_MIN_MS = 2000
const RECONNECT_MAX_MS = 30000
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
  private delay = RECONNECT_MIN_MS

  constructor(private readonly options: EventBridgeOptions) {}

  get clientId(): string | undefined {
    return this.readyClientId
  }

  get connected(): boolean {
    return this.readyClientId !== undefined
  }

  start(): void {
    if (this.closed) return
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
    debugLog(this.options.debug, 'mux', `将在 ${this.delay}ms 后重连`)
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, this.delay)
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS)
  }

  private async connect(): Promise<void> {
    if (this.closed) return
    debugLog(this.options.debug, 'mux', `连接 ${this.options.wsUrl}`)

    let cookie: string
    try {
      cookie = await this.options.getCookie()
    } catch {
      // 凭据暂时取不到（DSH 未就绪等），退避后重试，不影响插件其它能力
      this.scheduleReconnect()
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
      logger.debug(`[mux] 建立连接失败: ${error instanceof Error ? error.message : String(error)}`)
      this.scheduleReconnect()
      return
    }
    this.socket = socket

    socket.on('open', () => {
      debugLog(this.options.debug, 'mux', '已连接，订阅 $events 与 workspace/follow')
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
      this.delay = RECONNECT_MIN_MS
    })

    socket.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (error: Error) => {
      // 断线属于常态，只在调试时输出
      debugLog(this.options.debug, 'mux', `连接错误: ${error.message}`)
    })

    socket.on('close', () => {
      debugLog(this.options.debug, 'mux', '连接关闭')
      this.readyClientId = undefined
      this.socket = undefined
      this.scheduleReconnect()
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
