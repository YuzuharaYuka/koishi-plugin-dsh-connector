import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { h, type Context, type Session } from 'koishi'
import type { Config } from './config'
import { FORWARD_PLATFORMS, MESSAGES, effortLabel, presetLabel } from './constants'
import { toPlainText, stripChatMarkup } from './core/markdown'
import { loadFileSource, loadImageSource, sanitizeFileName, type TurnImage } from './core/media'
import { splitText } from './core/text'
import {
  DshTurnTimeout,
  type ApprovalDecision,
  type DshClient,
  type DshModelOption,
  type DshModelSelection,
  type DshSessionSummary,
  type TurnFile,
} from './services/dsh'
import { bindingKey, type BindingStore, type ChannelBinding } from './services/store'
import { getErrorMessage, logger, truncate } from './utils'

const INCOMING_IMAGE_TIMEOUT_MS = 15000
/** 单轮最多接收多少个聊天文件 */
const MAX_INCOMING_FILES = 5
/** 发送用的临时文件保留时长 */
const TEMP_FILE_TTL_MS = 3600_000

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

/** 取出消息里附带的文件元素 */
function collectSessionFiles(session: Session): Array<{ src: string; name: string }> {
  const elements = (session.elements ?? []) as unknown as Array<{ type?: string; attrs?: Record<string, unknown> }>
  const files: Array<{ src: string; name: string }> = []
  for (const element of elements) {
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
  for (const item of collectSessionFiles(session).slice(0, MAX_INCOMING_FILES)) {
    const loaded = await loadFileSource(item.src, item.name, maxBytes, INCOMING_IMAGE_TIMEOUT_MS)
    if (!loaded) {
      logger.debug(`[media] 文件读取失败或超出上限: ${item.name || item.src}`)
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
  return [
    '连接正常',
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
    const group = item.cwd?.trim() || '默认工作区'
    const list = groups.get(group) ?? []
    list.push(item)
    groups.set(group, list)
  }

  // 编号必须和绑定时用的顺序完全一致：按分组渲染的顺序展开后再存
  const ordered: DshSessionSummary[] = []
  const header =
    sessions.length < all.length
      ? `会话列表（显示 ${sessions.length} / 共 ${all.length} 个）`
      : `会话列表（共 ${sessions.length} 个）`
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

/** 附件回执：把图片与文件数量压缩成一句话 */
function acceptedMessage(images: number, files: number): string {
  const parts: string[] = []
  if (images > 0) parts.push(`${images} 张图片`)
  if (files > 0) parts.push(`${files} 个文件`)
  if (parts.length === 0) return MESSAGES.promptAccepted
  return `已提交到 DeepSeek Harness（含 ${parts.join('、')}），正在执行……`
}

export interface WorkspaceEntry {
  cwd: string
  count: number
  updatedAt: number
}

/** 从现有会话的 cwd 归纳出已知工作区，按最近使用排序 */
async function listWorkspaces(deps: HandlerDeps): Promise<WorkspaceEntry[]> {
  const sessions = await deps.client.listSessions()
  const map = new Map<string, WorkspaceEntry>()
  for (const item of sessions) {
    const cwd = item.cwd?.trim()
    if (!cwd) continue
    const entry = map.get(cwd) ?? { cwd, count: 0, updatedAt: 0 }
    entry.count += 1
    entry.updatedAt = Math.max(entry.updatedAt, item.updatedAt)
    map.set(cwd, entry)
  }
  return [...map.values()].sort((left, right) => right.updatedAt - left.updatedAt)
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
    return list[Number(value) - 1]?.cwd
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
    const flag = entry.cwd === deps.config.defaultWorkspace ? '（默认）' : ''
    lines.push(`${index + 1}. ${entry.cwd}（${entry.count} 个会话）${flag}`)
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
  const hasAttachments = (session.elements ?? []).some((element) => {
    const type = (element as { type?: string }).type
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
    const ack = acceptedMessage(images.length, files.length)
    await session.send(created ? `${MESSAGES.sessionCreated} ${ack}` : ack)

    try {
      const result = await deps.client.runTurn(binding.sessionId, input, images, files)
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
