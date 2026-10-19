import { h, type Context, type Session } from 'koishi'
import type { Config } from './config'
import { FORWARD_PLATFORMS, MESSAGES, presetLabel } from './constants'
import { toPlainText, stripChatMarkup } from './core/markdown'
import { loadImageSource, type TurnImage } from './core/media'
import { splitText } from './core/text'
import { DshTurnTimeout, type ApprovalDecision, type DshClient, type DshSessionSummary } from './services/dsh'
import { bindingKey, type BindingStore, type ChannelBinding } from './services/store'
import { getErrorMessage, logger, truncate } from './utils'

const INCOMING_IMAGE_TIMEOUT_MS = 15000

export interface HandlerDeps {
  ctx: Context
  config: Config
  client: DshClient
  store: BindingStore
  /** 每个聊天最近一次会话列表的顺序，用来按序号绑定 */
  listings: Map<string, DshSessionSummary[]>
  /** 正在执行任务的聊天：同一聊天不允许并发跑两轮 */
  running: Set<string>
}

/** 聊天窗口在绑定表中的键；私聊时 channelId 可能缺失 */
export function sessionKey(session: Session): string {
  return bindingKey(session.platform, session.selfId, session.channelId || session.userId || '')
}

/** 白名单条目既支持 `平台:ID`（uid/cid），也支持裸 ID */
function matchesIdentifier(list: string[], qualified: string, bare: string): boolean {
  return list.some((entry) => entry === qualified || entry === bare)
}

/**
 * 权限判定：只认用户白名单。
 *
 * `session.uid` 是 Koishi 的跨平台用户标识（`平台:用户ID`），裸用户 ID 也接受，
 * 方便直接从 `dsh.whoami` 复制。白名单为空表示谁都不允许。
 */
export function checkAccess(config: Config, session: Session): string | null {
  const uid = session.uid ?? ''
  if (config.allowUsers.length === 0) return MESSAGES.noWhitelist
  if (!matchesIdentifier(config.allowUsers, uid, session.userId ?? '')) {
    return MESSAGES.denied(uid)
  }
  return null
}

/** 会话 ID 很长，状态与确认信息里只显示前缀 */
export function shortSessionId(sessionId: string): string {
  return sessionId.length > 16 ? `${sessionId.slice(0, 16)}…` : sessionId
}

export function handleWhoami(deps: HandlerDeps, session: Session): string {
  const denied = checkAccess(deps.config, session)
  return [
    `用户：${session.uid}`,
    ...(session.guildId ? [`群组：${session.gid}`] : []),
    `权限：${denied ?? '允许'}`,
  ].join('\n')
}

function bindingOf(deps: HandlerDeps, session: Session): ChannelBinding | undefined {
  return deps.store.get(sessionKey(session))
}

function rememberBinding(deps: HandlerDeps, session: Session, sessionId: string, title: string): ChannelBinding {
  return deps.store.set({
    platform: session.platform,
    selfId: session.selfId,
    channelId: session.channelId || session.userId || '',
    sessionId,
    title,
  })
}

/** QQ 不渲染 Markdown，按配置转成纯文本 */
export function renderReply(config: Config, text: string): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  return config.replyFormat === 'text' ? toPlainText(trimmed) : trimmed
}

/**
 * 长回复的发送方式。
 *
 * 合并转发里每个节点同样有字数上限，所以两种模式都先按 chunkLength 切段：
 * 合并转发把每段作为一个节点，分段发送则逐条发出。
 */
async function sendLongText(
  deps: HandlerDeps,
  session: Session,
  chunks: string[],
  wantForward: boolean,
): Promise<void> {
  if (chunks.length === 0) return
  if (wantForward) {
    try {
      await session.send(h('message', { forward: true }, ...chunks.map((chunk) => h.text(chunk))))
      return
    } catch (error) {
      logger.warn(`[reply] 合并转发失败，改为分段发送: ${getErrorMessage(error)}`)
    }
  }
  for (const chunk of chunks) await session.send(chunk)
}

/** 取出消息里附带的图片来源，交给 DSH 作为图片块一起提交 */
function collectSessionImages(session: Session): string[] {
  const elements = (session.elements ?? []) as unknown as Array<{ type?: string; attrs?: Record<string, unknown> }>
  const sources: string[] = []
  for (const element of elements) {
    if (!element || (element.type !== 'img' && element.type !== 'image')) continue
    const attrs = element.attrs ?? {}
    const source = attrs.src ?? attrs.url ?? attrs.file
    if (typeof source === 'string' && source.trim()) sources.push(source.trim())
  }
  return sources
}

async function loadIncomingImages(deps: HandlerDeps, session: Session): Promise<TurnImage[]> {
  if (!deps.config.enableImages) return []
  const sources = collectSessionImages(session).slice(0, deps.config.maxImages)
  const maxBytes = deps.config.maxImageMb * 1024 * 1024
  const images: TurnImage[] = []
  for (const source of sources) {
    const image = await loadImageSource(source, maxBytes, INCOMING_IMAGE_TIMEOUT_MS)
    if (image && image.buffer.length <= maxBytes) images.push(image)
  }
  return images
}

export async function handlePing(deps: HandlerDeps, session: Session): Promise<string> {
  await deps.client.ensureReady()
  const info = deps.client.describe()
  const sessions = await deps.client.listSessions()
  const binding = bindingOf(deps, session)
  const bound = binding ? sessions.find((item) => item.sessionId === binding.sessionId) : undefined
  // 标题以 DSH 实时数据为准，绑定表里的只是绑定当时的快照
  const title = bound?.title || binding?.title || '未命名'
  return [
    'DSH 连接正常',
    `方式：${info.mode}`,
    `地址：${info.baseUrl ?? '未知'}`,
    `会话：${sessions.length} 个`,
    `事件桥：${info.bridge ? '已连接' : '未连接'}`,
    `当前绑定：${binding ? `${title}（${binding.sessionId}）` : '无'}`,
  ].join('\n')
}

export async function handleSessions(deps: HandlerDeps, session: Session, includeAll = false): Promise<string> {
  const all = await deps.client.listSessions({
    includeChildren: includeAll,
    includeBlank: includeAll,
  })
  if (all.length === 0) {
    deps.listings.delete(sessionKey(session))
    return MESSAGES.noSessions
  }

  // 已按最后修改时间倒序；默认只取最近一批，-a 时列出全部
  const cap = includeAll ? all.length : deps.config.sessionLimit
  const sessions = all.slice(0, cap)

  const binding = bindingOf(deps, session)
  const groups = new Map<string, DshSessionSummary[]>()
  for (const item of sessions) {
    const group = item.cwd?.trim() || '未分组'
    const list = groups.get(group) ?? []
    list.push(item)
    groups.set(group, list)
  }

  // 编号必须和绑定时用的顺序完全一致：按分组渲染的顺序展开后再存
  const ordered: DshSessionSummary[] = []
  const header =
    sessions.length < all.length
      ? `DSH 会话（显示 ${sessions.length} / 共 ${all.length} 个）`
      : `DSH 会话（共 ${sessions.length} 个）`
  const lines = [header]
  for (const [group, items] of groups) {
    lines.push(`【${group}】`)
    for (const item of items) {
      ordered.push(item)
      const title = item.title ? truncate(item.title, 28) : '（未命名）'
      const flags = [
        item.running ? '运行中' : '',
        item.sessionId === binding?.sessionId ? '当前绑定' : '',
        item.parentSessionId ? '子会话' : '',
      ]
        .filter(Boolean)
        .join('，')
      lines.push(`${ordered.length}. ${title}${flags ? `（${flags}）` : ''}`)
    }
  }
  deps.listings.set(sessionKey(session), ordered)
  if (sessions.length < all.length) {
    lines.push(`按修改时间排序，只显示最近 ${sessions.length} 个；加 -a 查看全部。`)
  }
  lines.push('用 dsh.use 序号绑定。')
  return lines.join('\n')
}

export async function handleNew(deps: HandlerDeps, session: Session, cwd?: string): Promise<string> {
  const sessionId = await deps.client.createSession(cwd)
  const title = cwd ? `cwd: ${cwd}` : ''
  rememberBinding(deps, session, sessionId, title)
  const applied = deps.config.defaultPermission
  return `已创建会话（${shortSessionId(sessionId)}）${applied ? `\n权限：${presetLabel(applied)}` : ''}`
}

export async function handleUse(deps: HandlerDeps, session: Session, target: string): Promise<string> {
  const value = target.trim()
  if (!value) return MESSAGES.sessionMissing

  // 纯数字按最近一次列表的序号绑定，免去复制会话 ID
  if (/^\d+$/.test(value)) {
    const listing = deps.listings.get(sessionKey(session))
    if (!listing) return MESSAGES.listFirst
    const item = listing[Number(value) - 1]
    if (!item) return MESSAGES.indexOutOfRange(listing.length)
    rememberBinding(deps, session, item.sessionId, item.title)
    return `已绑定：${item.title || '未命名'}（${shortSessionId(item.sessionId)}）`
  }

  const sessions = await deps.client.listSessions({ includeChildren: true, includeBlank: true })
  const matched =
    sessions.find((item) => item.sessionId === value) ??
    sessions.find((item) => item.sessionId.startsWith(value))
  if (!matched) return MESSAGES.sessionMissing

  rememberBinding(deps, session, matched.sessionId, matched.title)
  return `已绑定：${matched.title || '未命名'}（${shortSessionId(matched.sessionId)}）`
}

export async function handleRun(deps: HandlerDeps, session: Session, text: string): Promise<h.Fragment> {
  const input = stripChatMarkup(text)
  const images = await loadIncomingImages(deps, session)
  if (!input && images.length === 0) return MESSAGES.emptyUsage

  // 同一聊天同时只允许一轮：两个等待会互相看到对方的 turn，结果容易串
  const key = sessionKey(session)
  if (deps.running.has(key)) return MESSAGES.busy
  deps.running.add(key)

  try {
    let binding = bindingOf(deps, session)
    let created = false
    if (!binding) {
      const sessionId = await deps.client.createSession()
      binding = rememberBinding(deps, session, sessionId, '')
      created = true
    }

    const ack = images.length > 0 ? MESSAGES.promptAcceptedImages(images.length) : MESSAGES.promptAccepted
    await session.send(created ? `${MESSAGES.sessionCreated} ${ack}` : ack)

    try {
      const result = await deps.client.runTurn(binding.sessionId, input, images)
      const parts: (string | ReturnType<typeof h.image>)[] = []
      const output = renderReply(deps.config, result.text)
      const chunks = output ? splitText(output, deps.config.chunkLength) : []
      const wantForward = deps.config.mergeForward && FORWARD_PLATFORMS.includes(session.platform)
      // splitLength 为 0 时始终按长消息路径处理（短回复只有一段，仍与图片合并发送）
      const alwaysHandle = deps.config.splitLength === 0
      const tooLong = output.length > 0 && (alwaysHandle || output.length > deps.config.splitLength)
      const longPath = tooLong && (wantForward || chunks.length > 1)

      if (longPath) await sendLongText(deps, session, chunks, wantForward)
      else if (output) parts.push(output)

      for (const image of result.images) parts.push(h.image(image.buffer, image.type))
      if (result.skipped > 0) parts.push(MESSAGES.imagesSkipped(result.skipped))
      if (parts.length === 0) return longPath ? '' : MESSAGES.noContent
      return parts
    } catch (error) {
      if (error instanceof DshTurnTimeout) {
        const partial = renderReply(deps.config, error.partial)
        return partial ? `${partial}\n\n${MESSAGES.promptTimedOut}` : MESSAGES.promptTimedOut
      }
      throw error
    }
  } finally {
    deps.running.delete(key)
  }
}

export async function handleStop(deps: HandlerDeps, session: Session): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noBinding
  await deps.client.cancel(binding.sessionId)
  return MESSAGES.stopRequested
}

/**
 * 查看或切换当前会话的权限预设。
 *
 * DSH 没有独立的权限 RPC，切换走官方 `/permission` 斜杠命令；预设本身由
 * `dsh-permission-presets` 插件提供，同时决定沙箱模式与审批策略。
 */
export async function handlePermission(
  deps: HandlerDeps,
  session: Session,
  preset?: string,
): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noPermissionBinding

  const catalog = await deps.client.permissionPresets()
  const requested = (preset ?? '').trim()

  if (!requested) {
    const current = await deps.client.currentPermission(binding.sessionId)
    return [
      `当前权限：${presetLabel(current)}`,
      `可选：${catalog.map((value) => `${value}（${presetLabel(value)}）`).join('、')}`,
      '用 dsh.permission 加预设名切换。',
    ].join('\n')
  }

  if (catalog.length > 0 && !catalog.includes(requested)) {
    return MESSAGES.invalidPreset(requested, catalog.join('、'))
  }

  await deps.client.setPermission(binding.sessionId, requested)
  // 以请求值为准：投影可能还没刷新，回读反而会显示旧值
  return MESSAGES.permissionChanged(presetLabel(requested))
}

export async function handleHistory(deps: HandlerDeps, session: Session, limit?: number): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noBinding
  const count = limit && limit > 0 ? Math.min(limit, deps.config.historyLimit) : deps.config.historyLimit
  const messages = await deps.client.history(binding.sessionId, count)
  if (messages.length === 0) return '这个会话还没有助手回复。'
  return messages
    .map((item, index) => `${index + 1}. ${truncate(renderReply(deps.config, item), 1200)}`)
    .join('\n\n')
}

export async function handleApproval(
  deps: HandlerDeps,
  session: Session,
  decision: ApprovalDecision,
): Promise<string> {
  const binding = bindingOf(deps, session)
  const answered = await deps.client.answerApproval(decision, binding?.sessionId)
  if (!answered) return MESSAGES.noPendingApproval
  return decision === 'allow' ? MESSAGES.approveSent : MESSAGES.denySent
}
