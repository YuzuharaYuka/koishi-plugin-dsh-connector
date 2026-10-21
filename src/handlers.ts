import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { h, type Context, type Session } from 'koishi'
import type { Config } from './config'
import { FORWARD_PLATFORMS, MESSAGES, effortLabel, presetLabel } from './constants'
import { toPlainText, stripChatMarkup } from './core/markdown'
import { loadFileSource, loadImageSource, sanitizeFileName, type TurnImage } from './core/media'
import { estimateCost, formatCost, formatNumber, totalTokens } from './core/pricing'
import type { QuestionItem } from './core/mux'
import { splitText } from './core/text'
import {
  DshTurnTimeout,
  type ApprovalDecision,
  type BalanceInfo,
  type DshClient,
  type DshModelOption,
  type DshModelSelection,
  type DshSessionSummary,
  type TurnFile,
  type TurnResult,
} from './services/dsh'
import { bindingKey, type BindingStore, type ChannelBinding } from './services/store'
import { getErrorMessage, debugLog, logger, truncate } from './utils'

const INCOMING_IMAGE_TIMEOUT_MS = 15000
/** 单轮最多接收多少个聊天文件 */
const MAX_INCOMING_FILES = 5
/** 发送用的临时文件保留时长 */
const TEMP_FILE_TTL_MS = 3600_000
/** 提问等待回答的时长 */
const QUESTION_TTL_MS = 5 * 60 * 1000
/** 超时补发最多再等多久 */
const DEFERRED_TIMEOUT_MS = 30 * 60 * 1000

interface ChatElement {
  type?: string
  attrs?: Record<string, unknown>
}

/** 等待用户回答的提问 */
export interface PendingQuestion {
  sessionId: string
  callId: string
  questions: QuestionItem[]
  at: number
}

export interface HandlerDeps {
  ctx: Context
  config: Config
  client: DshClient
  store: BindingStore
  /** 每个聊天最近一次会话列表的顺序，用来按序号绑定 */
  listings: Map<string, DshSessionSummary[]>
  /** 正在执行任务的聊天：同一聊天不允许并发跑两轮 */
  running: Set<string>
  /** 等待回答的提问，按聊天隔离 */
  questions: Map<string, PendingQuestion>
  /** 已安排超时补发的聊天 */
  deferred: Set<string>
  /** 自然语言模式的按聊天覆盖（on/off） */
  chatMode: Map<string, boolean>
  /** 最近一次与插件交互的时间，用于自然语言窗口 */
  lastActive: Map<string, number>
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

/**
 * 当前消息 + 被引用消息里的元素。
 *
 * QQ 无法把文字和文件放进同一条消息，引用一条带附件的消息再发指令是唯一
 * 精确的表达方式：带什么由用户自己指定，不会把群里其他人的东西卷进来。
 * 引用解析失败时 quote 为空，只处理当前消息。
 */
function collectElements(session: Session): ChatElement[] {
  const current = (session.elements ?? []) as unknown as ChatElement[]
  const quoted = (session.event.message?.quote?.elements ?? []) as unknown as ChatElement[]
  return [...current, ...quoted]
}

/** 取出消息里附带的图片来源，交给 DSH 作为图片块一起提交 */
function collectSessionImages(session: Session): string[] {
  const sources: string[] = []
  for (const element of collectElements(session)) {
    if (!element || (element.type !== 'img' && element.type !== 'image')) continue
    const attrs = element.attrs ?? {}
    const source = attrs.src ?? attrs.url ?? attrs.file
    if (typeof source === 'string' && source.trim()) sources.push(source.trim())
  }
  return sources
}

async function loadIncomingImages(deps: HandlerDeps, session: Session): Promise<TurnImage[]> {
  if (!deps.config.enableImages) return []
  const sources = collectSessionImages(session).slice(-deps.config.maxImages)
  const maxBytes = deps.config.maxImageMb * 1024 * 1024
  const images: TurnImage[] = []
  for (const source of sources) {
    const image = await loadImageSource(source, maxBytes, INCOMING_IMAGE_TIMEOUT_MS)
    if (image && image.buffer.length <= maxBytes) images.push(image)
  }
  return images
}

/** 取出消息里附带的文件元素 */
function collectSessionFiles(session: Session): Array<{ src: string; name: string }> {
  const files: Array<{ src: string; name: string }> = []
  for (const element of collectElements(session)) {
    if (!element || element.type !== 'file') continue
    const attrs = element.attrs ?? {}
    const src = attrs.src ?? attrs.url ?? attrs.file
    if (typeof src !== 'string' || !src.trim()) continue
    const name = typeof attrs.title === 'string' ? attrs.title : typeof attrs.name === 'string' ? attrs.name : ''
    files.push({ src: src.trim(), name })
  }
  return files
}

/**
 * 读取聊天里的附件。
 *
 * 图片直接内联进 prompt；文件要先上传到 DSH 换取凭据，因此必须绑定好会话之后再做。
 */
async function loadIncomingAttachments(
  deps: HandlerDeps,
  session: Session,
  sessionId: string,
): Promise<{ images: TurnImage[]; files: TurnFile[] }> {
  const images = await loadIncomingImages(deps, session)
  if (!deps.config.enableFiles) return { images, files: [] }

  const maxBytes = deps.config.maxFileMb * 1024 * 1024
  const files: TurnFile[] = []
  for (const item of collectSessionFiles(session).slice(-MAX_INCOMING_FILES)) {
    const loaded = await loadFileSource(item.src, item.name, maxBytes, INCOMING_IMAGE_TIMEOUT_MS)
    if (!loaded) {
      debugLog(deps.config.debug, 'media', `文件读取失败或超出上限: ${item.name || item.src}`)
      continue
    }
    try {
      const receiptId = await deps.client.uploadFile(sessionId, loaded.name, loaded.mediaType, loaded.buffer)
      files.push({ receiptId, name: loaded.name })
    } catch (error) {
      logger.warn(`[media] 文件上传失败: ${getErrorMessage(error)}`)
    }
  }
  return { images, files }
}

export async function handlePing(deps: HandlerDeps, session: Session): Promise<string> {
  await deps.client.ensureReady()
  const info = deps.client.describe()
  const sessions = await deps.client.listSessions()
  const binding = bindingOf(deps, session)
  const bound = binding ? sessions.find((item) => item.sessionId === binding.sessionId) : undefined
  // 标题以 DSH 实时数据为准，绑定表里的只是绑定当时的快照
  const title = bound?.title || binding?.title || '未命名'
  const lines = [
    '连接正常',
    `方式：${info.mode}`,
    `地址：${info.baseUrl ?? '未知'}`,
    `会话：${sessions.length} 个`,
    `事件桥：${info.bridge ? '已连接' : '未连接'}`,
    `当前绑定：${binding ? `${title}（${binding.sessionId}）` : '无'}`,
  ]
  if (!binding) return lines.join('\n')

  lines.push(`工作区：${bound?.cwd ?? '未知'}`)
  lines.push(`任务：${bound?.running ? '正在执行' : '空闲'}`)

  // 模型与权限属于附加信息，读取失败不该让整个状态页不可用
  try {
    const snapshot = await deps.client.sessionSnapshot(binding.sessionId)
    const catalog = await deps.client.modelCatalog()
    const current = snapshot.model ?? catalog.defaultSelection
    const option = current
      ? catalog.models.find((item) => item.provider === current.provider && item.model === current.model)
      : undefined
    const modelText = current
      ? `${option?.name ?? current.model} · 思考 ${effortLabel(current.reasoningEffort)}`
      : '未知'
    lines.push(`模型：${modelText}`)
    lines.push(`权限：${presetLabel(snapshot.permission)}`)
  } catch (error) {
    logger.debug(`[ping] 读取会话状态失败: ${getErrorMessage(error)}`)
  }

  const notice = await balanceNotice(deps)
  if (notice) lines.push(notice)
  return lines.join('\n')
}

interface SessionGroup {
  key: string
  title: string
  sessions: DshSessionSummary[]
}

/** 每个会话最近一次更新的时间，用于给分组排序 */
function groupUpdatedAt(group: SessionGroup): number {
  return group.sessions.reduce((max, item) => Math.max(max, item.updatedAt), 0)
}

function sortByUpdated(items: DshSessionSummary[]): DshSessionSummary[] {
  return [...items].sort((left, right) => right.updatedAt - left.updatedAt)
}

/**
 * 按配置把会话分组。
 *
 * 工作区归属以 DSH 的 `workspace/follow` 基线为准：会话必须显式列在某个
 * 工作区的 sessionIds 里才算属于它，否则归入「未分组」——这与 DSH 界面一致，
 * 不能拿 cwd 去猜（否则斜杠写法不同就会冒出重复的工作区）。
 */
function buildSessionGroups(
  deps: HandlerDeps,
  sessions: DshSessionSummary[],
  filterOverride?: 'active' | 'all' | 'archived',
): {
  groups: SessionGroup[]
  hidden: number
} {
  const snapshot = deps.client.workspaceSnapshot
  const archived = new Set(snapshot?.archived ?? [])
  const filter = filterOverride ?? deps.config.sessionFilter

  const visible = sessions.filter((item) => {
    const isArchived = archived.has(item.sessionId)
    if (filter === 'archived') return isArchived
    if (filter === 'all') return true
    return !isArchived
  })
  const hidden = sessions.length - visible.length

  if (deps.config.sessionGroupBy === 'flat' || !snapshot) {
    const sorted = deps.config.sessionSortBy === 'manual' ? visible : sortByUpdated(visible)
    return { groups: visible.length > 0 ? [{ key: '', title: '', sessions: sorted }] : [], hidden }
  }

  const byId = new Map(visible.map((item) => [item.sessionId, item]))
  const groups: SessionGroup[] = []
  const used = new Set<string>()

  for (const workspace of snapshot.workspaces) {
    const members: DshSessionSummary[] = []
    for (const sessionId of workspace.sessionIds) {
      const item = byId.get(sessionId)
      if (!item) continue
      members.push(item)
      used.add(sessionId)
    }
    if (members.length === 0) continue
    groups.push({
      key: workspace.id,
      title: workspace.title,
      sessions: deps.config.sessionSortBy === 'manual' ? members : sortByUpdated(members),
    })
  }

  const rest = visible.filter((item) => !used.has(item.sessionId))
  if (rest.length > 0) {
    groups.push({ key: 'ungrouped', title: '未分组', sessions: sortByUpdated(rest) })
  }

  // 手动排序保持 DSH 里的工作区顺序；最近更新则按组内最新会话排
  if (deps.config.sessionSortBy !== 'manual') {
    groups.sort((left, right) => groupUpdatedAt(right) - groupUpdatedAt(left))
  }
  return { groups, hidden }
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

  const { groups, hidden } = buildSessionGroups(deps, all, includeAll ? 'all' : undefined)
  const visibleCount = groups.reduce((sum, group) => sum + group.sessions.length, 0)
  if (visibleCount === 0) {
    deps.listings.delete(sessionKey(session))
    return hidden > 0 ? `没有符合筛选条件的会话（已隐藏 ${hidden} 个）。` : MESSAGES.noSessions
  }

  // 列表上限作用在筛选后的会话上；-a 时列出全部
  const cap = includeAll ? visibleCount : deps.config.sessionLimit
  let budget = cap
  const binding = bindingOf(deps, session)
  const archivedSet = new Set(deps.client.workspaceSnapshot?.archived ?? [])
  const ordered: DshSessionSummary[] = []
  const lines: string[] = []
  const effectiveFilter = includeAll ? 'all' : deps.config.sessionFilter
  const header = [
    `会话列表（共 ${visibleCount} 个`,
    hidden > 0
      ? effectiveFilter === 'archived'
        ? '，仅已归档'
        : `，已隐藏 ${hidden} 个归档`
      : '',
    '）',
  ].join('')

  for (const group of groups) {
    if (budget <= 0) break
    const items = group.sessions.slice(0, budget)
    budget -= items.length
    if (items.length === 0) continue
    if (group.title) lines.push(`【${group.title}】`)
    for (const item of items) {
      ordered.push(item)
      const title = item.title ? truncate(item.title, 28) : '（未命名）'
      const flags = [
        item.running ? '运行中' : '',
        item.sessionId === binding?.sessionId ? '当前绑定' : '',
        archivedSet.has(item.sessionId) ? '已归档' : '',
        item.parentSessionId ? '子会话' : '',
      ]
        .filter(Boolean)
        .join('，')
      lines.push(`${ordered.length}. ${title}${flags ? `（${flags}）` : ''}`)
    }
  }

  deps.listings.set(sessionKey(session), ordered)
  const output = [header, ...lines]
  if (ordered.length < visibleCount) {
    output.push(`按当前排序只显示最近 ${ordered.length} 个；加 -a 查看全部。`)
  }
  output.push('用 dsh.use 序号绑定。')
  return output.join('\n')
}

/** 本轮 token 用量与估算费用 */
function usageText(config: Config, result: TurnResult): string | undefined {
  if (!config.showUsage) return undefined
  const usage = result.usage
  if (totalTokens(usage) === 0) return undefined

  const input = usage.uncachedInputTokens + usage.cacheWriteTokens
  const segments = [
    `输入 ${formatNumber(input)}`,
    `缓存命中 ${formatNumber(usage.cacheReadTokens)}`,
    `输出 ${formatNumber(usage.outputTokens)}`,
  ]
  let text = `本轮用量：${segments.join(' · ')}`
  if (config.showCost && result.model) {
    const cost = estimateCost(usage, result.model)
    if (cost !== undefined) text += `，估算 ${formatCost(cost)}`
  }
  return text
}

function totalBalance(info: BalanceInfo): number {
  return [...info.wallets, ...info.bonusWallets].reduce((sum, item) => sum + item.balance, 0)
}

/** 余额低于告警线时给一句话；未配置或读取失败都静默 */
async function balanceNotice(deps: HandlerDeps): Promise<string | undefined> {
  const threshold = deps.config.balanceWarning
  if (threshold <= 0) return undefined
  try {
    const info = await deps.client.accountBalance()
    if (!info) return undefined
    const total = totalBalance(info)
    if (total >= threshold) return undefined
    return MESSAGES.balanceLow(`¥${total.toFixed(2)}`, threshold)
  } catch {
    return undefined
  }
}

/** 查看账户余额 */
export async function handleBalance(deps: HandlerDeps): Promise<string> {
  let info: BalanceInfo | undefined
  try {
    info = await deps.client.accountBalance()
  } catch (error) {
    return `读取余额失败：${getErrorMessage(error)}`
  }
  if (!info) return MESSAGES.balanceUnavailable

  const symbol = info.wallets[0]?.currency === 'USD' ? '$' : '¥'
  const lines = ['账户余额']
  for (const item of info.wallets) lines.push(`充值余额：${symbol}${item.balance.toFixed(2)}`)
  for (const item of info.bonusWallets) lines.push(`赠送余额：${symbol}${item.balance.toFixed(2)}`)

  const threshold = deps.config.balanceWarning
  if (threshold > 0 && totalBalance(info) < threshold) {
    lines.push(MESSAGES.balanceLow(`${symbol}${totalBalance(info).toFixed(2)}`, threshold))
  }
  return lines.join('\n')
}

/** 附件回执：把图片与文件数量压缩成一句话 */
function acceptedMessage(images: number, files: number): string {
  const parts: string[] = []
  if (images > 0) parts.push(`${images} 张图片`)
  if (files > 0) parts.push(`${files} 个文件`)
  if (parts.length === 0) return MESSAGES.promptAccepted
  return `已提交到 DeepSeek Harness（含 ${parts.join('、')}），正在执行……`
}

export interface WorkspaceEntry {
  title: string
  path: string
  count: number
}

/** 统一斜杠与大小写，避免 `D:/x` 和 `D:\x` 被当成两个目录 */
function normalizePath(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

/**
 * 已知工作区。
 *
 * 优先用 DSH 的工作区基线（带标题），基线还没到时退化为按会话 cwd 归纳。
 */
async function listWorkspaces(deps: HandlerDeps): Promise<WorkspaceEntry[]> {
  const snapshot = deps.client.workspaceSnapshot
  if (snapshot) {
    return snapshot.workspaces.map((workspace) => ({
      title: workspace.title,
      path: workspace.path,
      count: workspace.sessionIds.length,
    }))
  }

  const sessions = await deps.client.listSessions()
  const map = new Map<string, WorkspaceEntry>()
  for (const item of sessions) {
    const cwd = item.cwd?.trim()
    if (!cwd) continue
    const key = normalizePath(cwd)
    const entry = map.get(key) ?? { title: cwd, path: cwd, count: 0 }
    entry.count += 1
    map.set(key, entry)
  }
  return [...map.values()]
}

function expandHome(path: string): string {
  if (path === '~') return homedir()
  if (path.startsWith('~/') || path.startsWith('~\\')) return join(homedir(), path.slice(2))
  return path
}

/** 序号 → 已知工作区；其它按路径处理；省略时用配置里的默认工作区 */
async function resolveWorkspace(deps: HandlerDeps, target?: string): Promise<string | undefined> {
  const value = (target ?? '').trim()
  if (!value) return deps.config.defaultWorkspace || undefined
  if (/^\d+$/.test(value)) {
    const list = await listWorkspaces(deps)
    return list[Number(value) - 1]?.path
  }
  return expandHome(value)
}

/**
 * 新建会话。
 *
 * 参数可以是工作区序号（来自 dsh.workspaces）、绝对路径，或省略走 `defaultWorkspace`。
 */
export async function handleNew(deps: HandlerDeps, session: Session, target?: string): Promise<string> {
  const cwd = await resolveWorkspace(deps, target)
  if (target?.trim() && !cwd) return MESSAGES.workspaceMissing(target.trim())

  const sessionId = await deps.client.createSession(cwd)
  rememberBinding(deps, session, sessionId, cwd ? `cwd: ${cwd}` : '')
  const applied = deps.config.defaultPermission
  const lines = [`已创建会话（${shortSessionId(sessionId)}）`]
  if (cwd) lines.push(`工作区：${cwd}`)
  if (applied) lines.push(`权限：${presetLabel(applied)}`)
  return lines.join('\n')
}

/** 列出已知工作区，供 dsh.new 按序号选择 */
export async function handleWorkspaces(deps: HandlerDeps): Promise<string> {
  const list = await listWorkspaces(deps)
  if (list.length === 0) return MESSAGES.noWorkspace
  const lines = ['已知工作区']
  list.forEach((entry, index) => {
    const flag = normalizePath(entry.path) === normalizePath(deps.config.defaultWorkspace)
      ? '（默认）'
      : ''
    lines.push(`${index + 1}. ${entry.title}（${entry.path}，${entry.count} 个会话）${flag}`)
  })
  lines.push('用 dsh.new 序号 在该工作区新建，或 dsh.new 加绝对路径。')
  return lines.join('\n')
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
  const hasAttachments = collectElements(session).some((element) => {
    const type = element?.type
    return type === 'img' || type === 'image' || type === 'file'
  })
  if (!input && !hasAttachments) return MESSAGES.emptyUsage

  // 同一聊天同时只允许一轮：两个等待会互相看到对方的 turn，结果容易串
  const key = sessionKey(session)
  if (deps.running.has(key)) return MESSAGES.busy
  deps.running.add(key)

  try {
    let binding = bindingOf(deps, session)
    let created = false
    if (!binding) {
      const sessionId = await deps.client.createSession(deps.config.defaultWorkspace || undefined)
      binding = rememberBinding(deps, session, sessionId, '')
      created = true
    }

    // 文件要先上传到 DSH 换凭据，所以必须等绑定确定之后再读附件
    const { images, files } = await loadIncomingAttachments(deps, session, binding.sessionId)
    if (!input && images.length === 0 && files.length === 0) return MESSAGES.emptyUsage
    const ack = acceptedMessage(images.length, files.length)
    await session.send(created ? `${MESSAGES.sessionCreated} ${ack}` : ack)

    try {
      const result = await deps.client.runTurn(binding.sessionId, input, images, files)
      // 回合结束，任何还挂着的提问都已失效（可能在 Web 界面答过）
      deps.questions.delete(key)
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

      const usage = usageText(deps.config, result)
      if (usage) parts.push(parts.length > 0 ? `\n\n${usage}` : usage)

      const notice = await balanceNotice(deps)
      if (notice) parts.push(parts.length > 0 ? `\n${notice}` : notice)

      if (parts.length === 0) return longPath ? '' : MESSAGES.noContent
      return parts
    } catch (error) {
      if (error instanceof DshTurnTimeout) {
        const partial = renderReply(deps.config, error.partial)
        // 任务还在跑：后台继续等待，完成时补发到这个聊天
        scheduleDeferredDelivery(deps, session, binding.sessionId, error.baseline)
        return partial ? `${partial}\n\n${MESSAGES.promptDeferred}` : MESSAGES.promptDeferred
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
  deps.questions.delete(sessionKey(session))
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

/** 序号、模型 ID 或显示名都能选中模型 */
function resolveModelOption(options: DshModelOption[], target: string): DshModelOption | undefined {
  const value = target.trim()
  if (/^\d+$/.test(value)) return options[Number(value) - 1]
  const lower = value.toLowerCase()
  return (
    options.find((item) => item.model.toLowerCase() === lower) ??
    options.find((item) => item.name.toLowerCase() === lower) ??
    options.find((item) => item.model.toLowerCase().includes(lower))
  )
}

function modelLabel(selection: DshModelSelection | undefined, options: DshModelOption[]): string {
  if (!selection) return '未知'
  const option = options.find((item) => item.provider === selection.provider && item.model === selection.model)
  return `${option?.name ?? selection.model}，思考 ${effortLabel(selection.reasoningEffort)}`
}

/** 查看或切换模型；思考等级可以跟在序号后面一起设置 */
export async function handleModel(
  deps: HandlerDeps,
  session: Session,
  target?: string,
  effort?: string,
): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noModelBinding

  const catalog = await deps.client.modelCatalog()
  const options = catalog.models
  if (options.length === 0) return 'DSH 没有返回可用的模型。'
  // 新会话还没选过模型时，用部署默认值兜底
  const current = (await deps.client.modelSelection(binding.sessionId)) ?? catalog.defaultSelection

  if (!target?.trim()) {
    const lines = [`当前模型：${modelLabel(current, options)}`]
    options.forEach((option, index) => {
      const isCurrent =
        current !== undefined && option.provider === current.provider && option.model === current.model
      const efforts = option.efforts.map((item) => item.id).join('/')
      const suffix = [efforts, isCurrent ? '← 当前' : ''].filter(Boolean).join(' · ')
      lines.push(`${index + 1}. ${option.name}（${option.providerName}）${suffix ? ` ${suffix}` : ''}`)
    })
    lines.push('用 dsh.model 序号 [思考等级] 切换。')
    return lines.join('\n')
  }

  const option = resolveModelOption(options, target)
  if (!option) return MESSAGES.invalidModel(target.trim())

  const requestedEffort = (effort ?? '').trim()
  let nextEffort = requestedEffort || current?.reasoningEffort || option.defaultEffort
  if (nextEffort && option.efforts.length > 0 && !option.efforts.some((item) => item.id === nextEffort)) {
    // 用户显式指定的等级不合法就报错；从旧模型继承来的则退回新模型的默认等级
    if (requestedEffort) {
      return MESSAGES.invalidEffort(requestedEffort, option.efforts.map((item) => item.id).join('、'))
    }
    nextEffort = option.defaultEffort ?? option.efforts[0]?.id
  }

  await deps.client.selectModel(binding.sessionId, option.provider, option.model, nextEffort)
  return `已切换模型：${option.name}，思考 ${effortLabel(nextEffort)}`
}

/** 只调整思考等级，模型保持不变 */
export async function handleThink(deps: HandlerDeps, session: Session, effort?: string): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noModelBinding

  const catalog = await deps.client.modelCatalog()
  const options = catalog.models
  const current = (await deps.client.modelSelection(binding.sessionId)) ?? catalog.defaultSelection
  if (!current) return 'DSH 没有返回当前模型，先发 dsh.model 查看列表。'

  const option = options.find((item) => item.provider === current.provider && item.model === current.model)
  const efforts = option?.efforts ?? []
  if (efforts.length === 0) return MESSAGES.noEffortChoice

  const value = (effort ?? '').trim()
  if (!value) {
    return [
      `当前思考等级：${effortLabel(current.reasoningEffort)}`,
      `可选：${efforts.map((item) => item.id).join('、')}`,
      '用 dsh.think 等级 切换。',
    ].join('\n')
  }
  if (!efforts.some((item) => item.id === value)) {
    return MESSAGES.invalidEffort(value, efforts.map((item) => item.id).join('、'))
  }

  await deps.client.selectModel(binding.sessionId, current.provider, current.model, value)
  return `已切换思考等级：${effortLabel(value)}`
}

async function tempDir(deps: HandlerDeps): Promise<string> {
  return join(deps.ctx.baseDir, 'data', 'koishi-plugin-dsh-connector', 'files')
}

/** 旧的临时文件会在下一次发送时顺手清掉 */
async function pruneTempFiles(dir: string): Promise<void> {
  try {
    const now = Date.now()
    for (const item of await readdir(dir)) {
      const full = join(dir, item)
      try {
        const info = await stat(full)
        if (now - info.mtimeMs > TEMP_FILE_TTL_MS) await unlink(full)
      } catch {
        // 单个文件清理失败不影响发送
      }
    }
  } catch {
    // 目录还不存在
  }
}

/** 把工作区文件落到本地临时目录，供 OneBot 适配器用 file:// 上传 */
async function writeTempFile(deps: HandlerDeps, name: string, buffer: Buffer): Promise<string> {
  const dir = await tempDir(deps)
  await mkdir(dir, { recursive: true })
  await pruneTempFiles(dir)
  const file = join(dir, `${Date.now()}-${sanitizeFileName(name)}`)
  await writeFile(file, buffer)
  return file
}

/** 取回会话工作区里的文件并发到聊天 */
export async function handleGet(deps: HandlerDeps, session: Session, path?: string): Promise<h.Fragment> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noBinding

  const target = (path ?? '').trim()
  if (!target) return MESSAGES.getUsage

  const maxBytes = deps.config.maxFileMb * 1024 * 1024
  let file: { name: string; buffer: Buffer }
  try {
    file = await deps.client.readWorkspaceFile(binding.sessionId, target, maxBytes)
  } catch (error) {
    return `读取失败：${getErrorMessage(error)}`
  }

  const tempPath = await writeTempFile(deps, file.name, file.buffer)
  return h('file', { src: pathToFileURL(tempPath).href, title: file.name })
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

/** 解析会话目标：序号（最近一次列表）、完整 ID 或唯一前缀；省略时用当前绑定 */
async function resolveSessionTarget(
  deps: HandlerDeps,
  session: Session,
  target?: string,
): Promise<string | undefined> {
  const value = (target ?? '').trim()
  if (!value) return bindingOf(deps, session)?.sessionId

  if (/^\d+$/.test(value)) {
    const listing = deps.listings.get(sessionKey(session))
    return listing?.[Number(value) - 1]?.sessionId
  }

  const sessions = await deps.client.listSessions({ includeChildren: true, includeBlank: true })
  return (
    sessions.find((item) => item.sessionId === value)?.sessionId ??
    sessions.find((item) => item.sessionId.startsWith(value))?.sessionId
  )
}

/** 归档或取消归档会话 */
export async function handleArchive(
  deps: HandlerDeps,
  session: Session,
  target: string | undefined,
  archive: boolean,
): Promise<string> {
  const sessionId = await resolveSessionTarget(deps, session, target)
  if (!sessionId) return MESSAGES.sessionMissing

  if (archive) await deps.client.archiveSession(sessionId)
  else await deps.client.unarchiveSession(sessionId)

  return archive
    ? `已归档：${shortSessionId(sessionId)}`
    : `已取消归档：${shortSessionId(sessionId)}`
}

/** 把提问渲染成聊天里能直接回答的形式 */
export function renderQuestions(questions: QuestionItem[]): string {
  const lines: string[] = []
  if (questions.length === 1) {
    const item = questions[0]
    lines.push(item.header ? `需要你确认：${item.header}` : '需要你确认')
    lines.push(item.question)
    item.options.forEach((option, index) => {
      lines.push(`${index + 1}. ${option.label}${option.description ? ` —— ${option.description}` : ''}`)
    })
    lines.push(
      item.multiSelect
        ? '回复序号（多选用逗号分隔），也可以直接回复文字。'
        : '回复序号，也可以直接回复文字。',
    )
    return lines.join('\n')
  }

  lines.push(`需要你确认 ${questions.length} 个问题`)
  questions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.question}`)
    item.options.forEach((option, optionIndex) => lines.push(`   ${optionIndex + 1}) ${option.label}`))
  })
  lines.push('按顺序回复序号，用逗号分隔，例如 1,2。')
  return lines.join('\n')
}

const NUMBER_RE = /^\d+$/

/** 解析用户回答；多选题按序号返回 label，其它文字当作自定义回答 */
export function parseQuestionAnswer(
  questions: QuestionItem[],
  text: string,
): { answers: Array<{ id: string; selected: string[]; custom?: string }> } | { error: string } {
  const value = text.trim()
  if (!value) return { error: '请回复选项序号或文字。' }

  if (questions.length === 1) {
    const question = questions[0]
    const tokens = value.split(/[,，、\s]+/).filter(Boolean)
    if (tokens.length > 0 && tokens.every((token) => NUMBER_RE.test(token)) && question.options.length > 0) {
      const selected: string[] = []
      for (const token of tokens) {
        const option = question.options[Number(token) - 1]
        if (!option) return { error: `选项 ${token} 不存在。` }
        selected.push(option.label)
      }
      return { answers: [{ id: question.id, selected }] }
    }
    return { answers: [{ id: question.id, selected: [], custom: value }] }
  }

  const tokens = value
    .split(/[,，、]+/)
    .map((token) => token.trim())
    .filter(Boolean)
  if (tokens.length !== questions.length) {
    return { error: `共 ${questions.length} 个问题，请按顺序回复 ${questions.length} 个序号，用逗号分隔。` }
  }

  const answers: Array<{ id: string; selected: string[] }> = []
  for (let index = 0; index < questions.length; index += 1) {
    const question = questions[index]
    const token = tokens[index]
    if (!NUMBER_RE.test(token)) return { error: `第 ${index + 1} 个问题需要回复序号。` }
    const option = question.options[Number(token) - 1]
    if (!option) return { error: `第 ${index + 1} 个问题没有选项 ${token}。` }
    answers.push({ id: question.id, selected: [option.label] })
  }
  return { answers }
}

/** 有提问待回答时消费这条消息；未消费返回 undefined */
export async function answerPendingQuestion(
  deps: HandlerDeps,
  session: Session,
  text: string,
): Promise<string | undefined> {
  const key = sessionKey(session)
  const pending = deps.questions.get(key)
  if (!pending) return undefined
  if (Date.now() - pending.at > QUESTION_TTL_MS) {
    deps.questions.delete(key)
    return MESSAGES.questionExpired
  }
  if (checkAccess(deps.config, session) !== null) return undefined

  const parsed = parseQuestionAnswer(pending.questions, text)
  if ('error' in parsed) return parsed.error

  try {
    await deps.client.answerQuestion(pending.sessionId, pending.callId, parsed.answers)
  } catch (error) {
    return `提交回答失败：${getErrorMessage(error)}`
  }
  deps.questions.delete(key)

  const labels = parsed.answers.flatMap((item) =>
    item.selected.length > 0 ? item.selected : [item.custom ?? ''],
  )
  return labels.length > 0 ? `已提交选择：${labels.join('、')}` : '已提交回答。'
}

/** 把补充指令注入正在运行的任务；没有在跑就按普通任务处理 */
export async function handleSteer(deps: HandlerDeps, session: Session, text: string): Promise<h.Fragment> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noBinding
  const input = stripChatMarkup(text)
  if (!input) return MESSAGES.emptyUsage
  if (!deps.running.has(sessionKey(session))) return handleRun(deps, session, input)

  await deps.client.steer(binding.sessionId, input)
  return MESSAGES.steerAccepted
}

/** /compact 与 /clear：交给 DSH 自己的命令处理 */
export async function handleContextCommand(
  deps: HandlerDeps,
  session: Session,
  kind: 'compact' | 'clear',
): Promise<string> {
  const binding = bindingOf(deps, session)
  if (!binding) return MESSAGES.noBinding
  const result = await deps.client.runCommand(binding.sessionId, `/${kind}`)
  if (result.text) return result.text
  if (result.kind === 'success') return kind === 'compact' ? '已压缩上下文。' : '已清空上下文。'
  return 'DSH 没有返回结果。'
}

/** 记录一次交互，自然语言窗口据此续期 */
export function touchSession(deps: HandlerDeps, session: Session): void {
  deps.lastActive.set(sessionKey(session), Date.now())
}

/** 私聊里是否该把这句普通消息直接当作指令 */
export function shouldRunNaturalLanguage(deps: HandlerDeps, session: Session): boolean {
  if (!session.isDirect) return false
  if (checkAccess(deps.config, session) !== null) return false

  const key = sessionKey(session)
  const override = deps.chatMode.get(key)
  const enabled = override ?? deps.config.naturalLanguagePrivate
  if (!enabled) return false
  // 手动开启不看窗口，配置开启则要求最近有过交互
  if (override === true) return true
  const last = deps.lastActive.get(key) ?? 0
  return Date.now() - last <= deps.config.chatIdleMinutes * 60_000
}

export function handleChatMode(deps: HandlerDeps, session: Session, action?: string): string {
  const key = sessionKey(session)
  const value = (action ?? '').trim().toLowerCase()
  const override = deps.chatMode.get(key)
  const configured = deps.config.naturalLanguagePrivate

  if (!value) {
    const enabled = override ?? configured
    const last = deps.lastActive.get(key) ?? 0
    const lines = [
      `自然语言模式：${enabled ? '开启' : '关闭'}${override === undefined ? '（跟随配置）' : '（手动设置）'}`,
    ]
    if (enabled) {
      lines.push(
        override === true
          ? '手动开启不受空闲限制，发 dsh.chat off 关闭。'
          : `最近 ${deps.config.chatIdleMinutes} 分钟内交互过才会直通，超时自动失效。`,
      )
    }
    if (last > 0) lines.push(`最近一次交互：${Math.round((Date.now() - last) / 60000)} 分钟前`)
    lines.push('用 dsh.chat on 或 dsh.chat off 调整。')
    return lines.join('\n')
  }

  if (value === 'on' || value === '开启') {
    deps.chatMode.set(key, true)
    return '已开启自然语言模式：私聊里不带指令前缀的消息会直接发给 DSH。'
  }
  if (value === 'off' || value === '关闭') {
    deps.chatMode.set(key, false)
    return '已关闭自然语言模式。'
  }
  return '用法：dsh.chat on / off'
}

/** 超时后继续跟踪任务，完成时补发到原聊天 */
function scheduleDeferredDelivery(
  deps: HandlerDeps,
  session: Session,
  sessionId: string,
  baseline: number,
): void {
  const key = sessionKey(session)
  if (deps.deferred.has(key)) return
  deps.deferred.add(key)

  void (async () => {
    try {
      const result = await deps.client.awaitTurn(sessionId, baseline, DEFERRED_TIMEOUT_MS)
      const output = renderReply(deps.config, result.text)
      if (output) await session.send(output)
    } catch (error) {
      logger.debug(`[defer] 补发失败: ${getErrorMessage(error)}`)
    } finally {
      deps.deferred.delete(key)
    }
  })()
}
