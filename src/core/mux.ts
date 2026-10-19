import WebSocket from 'ws'
import { callRpc } from './rpc'
import { logger } from '../utils'

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

export interface EventBridgeOptions {
  wsUrl: string
  baseUrl: string
  getCookie: () => Promise<string>
  onApproval: (request: ApprovalRequest) => void
  debug: boolean
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
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined
      void this.connect()
    }, this.delay)
    this.delay = Math.min(this.delay * 2, RECONNECT_MAX_MS)
  }

  private async connect(): Promise<void> {
    if (this.closed) return

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
      socket.send(JSON.stringify({
        type: 'open',
        streamId: 'koishi-plugin-dsh',
        endpoint: '$events',
        payload: { args: {} },
      }))
      this.delay = RECONNECT_MIN_MS
    })

    socket.on('message', (raw: WebSocket.RawData) => {
      this.handleMessage(raw.toString())
    })

    socket.on('error', (error: Error) => {
      if (this.options.debug) {
        // 断线属于常态，只在调试时输出
        logger.debug(`[mux] 事件桥错误: ${error.message}`)
      }
    })

    socket.on('close', () => {
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

    if (payload.type === 'ready') {
      const clientId = typeof payload.clientId === 'string' ? payload.clientId : ''
      this.readyClientId = clientId || undefined
      return
    }

    const approval = readApprovalFrame(payload)
    if (approval) {
      this.options.onApproval(approval)
      return
    }

    if (this.options.debug) {
      logger.debug(`[mux] 未识别的事件帧: ${text.slice(0, 400)}`)
    }
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
