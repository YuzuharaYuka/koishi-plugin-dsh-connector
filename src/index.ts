import type { Context } from 'koishi'
import { join } from 'node:path'
import { type Config, normalizeConfig } from './config'
import { registerCommands } from './commands'
import { MESSAGES, PLUGIN_NAME } from './constants'
import { stripChatMarkup } from './core/markdown'
import {
  answerPendingQuestion,
  handleRun,
  renderQuestions,
  shouldRunNaturalLanguage,
  touchSession,
  type PendingQuestion,
} from './handlers'
import { DshClient, type DshSessionSummary } from './services/dsh'
import { BindingStore, bindingKey } from './services/store'
import { getErrorMessage, debugLog, logger } from './utils'

export * from './config'
export const name = PLUGIN_NAME

export const usage = `
通过聊天平台控制同一台主机上运行的 DeepSeek Harness 会话。

| 指令 | 别名 | 说明 |
| :--- | :--- | :--- |
| \`dsh.ping\` | \`dsh状态\` | 连接状态与当前绑定 |
| \`dsh.sessions\` | \`dsh会话\` | 会话列表，加 \`-a\` 显示全部 |
| \`dsh.new [目录/序号]\` | \`dsh新建\` | 新建并绑定会话 |
| \`dsh.workspaces\` | \`dsh工作区\` | 列出已知工作区 |
| \`dsh.use 序号\` | \`dsh切换\` | 按序号或 ID 绑定 |
| \`dsh.archive [序号]\` / \`dsh.unarchive [序号]\` | \`dsh归档\` / \`dsh取消归档\` | 归档或恢复会话 |
| \`dsh.run 内容\` | \`dsh运行\` | 交给 DSH 执行 |
| \`dsh.steer 内容\` | \`dsh插话\` | 往运行中的任务补充指令 |
| \`dsh.compact\` / \`dsh.clear\` | \`dsh压缩\` / \`dsh清空\` | 压缩或清空上下文 |
| \`dsh.chat on/off\` | \`dsh对话\` | 私聊自然语言模式 |
| \`dsh.stop\` | \`dsh停止\` | 停止当前任务 |
| \`dsh.history [条数]\` | \`dsh历史\` | 回放最近回复 |
| \`dsh.model [序号] [等级]\` | \`dsh模型\` | 查看或切换模型与思考等级 |
| \`dsh.think [等级]\` | \`dsh思考\` | 只调整思考等级 |
| \`dsh.get 路径\` | \`dsh取文件\` | 取回工作区里的文件 |
| \`dsh.balance\` | \`dsh余额\` | 查看账户余额 |
| \`dsh.permission [预设]\` | \`dsh权限\` | 查看或切换权限预设 |
| \`dsh.approve\` / \`dsh.deny\` | \`dsh允许\` / \`dsh拒绝\` | 处理授权 |
| \`dsh.whoami\` | \`dsh我是谁\` | 查看自己的标识 |

**回复格式**：\`replyFormat\` 选 \`text\` 把 Markdown 重排成纯文本，选 \`image\` 渲染成 DSH 配色的图片（需要 \`koishi-plugin-puppeteer\`，没装时自动回退文本）。公式用 KaTeX 转 MathML，深浅配色都能正常显示；图片模式下用量与余额提示单独成一条消息。

**权限**：只认用户白名单，写 \`平台:用户ID\`（如 \`onebot:123456\`）。名单内用户在私聊和群聊都能用；白名单为空时所有指令都会被拒绝（\`dsh.whoami\` 除外，用于取自己的标识）。

**风险提示**：DSH 会话可执行本机命令、写入文件，被放行的用户等于拥有本机权限，请谨慎添加。
`

export function apply(ctx: Context, rawConfig: Config): void {
  const config = normalizeConfig(rawConfig)
  const store = new BindingStore(join(ctx.baseDir, 'data', 'koishi-plugin-dsh-connector', 'bindings.json'))
  const client = new DshClient(config)
  // 每个聊天最近一次 `dsh.sessions` 的顺序，供 `dsh.use <序号>` 使用
  const listings = new Map<string, DshSessionSummary[]>()
  // 正在执行任务的聊天，避免同一聊天并发跑两轮
  const running = new Set<string>()
  // 等待回答的提问、已安排补发的聊天、自然语言覆盖与最近交互时间
  const questions = new Map<string, PendingQuestion>()
  const deferred = new Set<string>()
  const chatMode = new Map<string, boolean>()
  const lastActive = new Map<string, number>()

  ctx.on('ready', async () => {
    debugLog(config.debug, 'plugin', `启动，白名单 ${config.allowUsers.length} 人，模式 ${config.mode}`)
    await store.load()
    if (config.allowUsers.length === 0) {
      logger.warn('未配置用户白名单，所有指令都会被拒绝；用 dsh.whoami 取到标识后填入 allowUsers。')
    }
    try {
      await client.ensureReady()
      const info = client.describe()
      logger.info(`已连接 DSH (${info.mode}) ${info.baseUrl ?? ''}`)
      debugLog(config.debug, 'plugin', `事件桥 ${info.bridge ? '已连接' : '未连接'}`)
    } catch (error) {
      // 连不上不该拖垮 Koishi；指令触发时还会再试一次
      logger.error('连接 DSH 失败，插件暂不可用。')
      logger.error(`原因: ${getErrorMessage(error)}`)
    }
  })

  // 授权请求只在这条 WebSocket 上下发，收到后推回绑定过的聊天
  client.setApprovalHandler((request) => {
    const binding = request.sessionId ? store.findBySession(request.sessionId) : undefined
    if (!binding) {
      debugLog(config.debug, 'approval', '没有对应的聊天绑定，跳过推送')
      return
    }
    debugLog(
      config.debug,
      'approval',
      `推送到 ${binding.platform}:${binding.channelId} tool=${request.tool ?? '未知'}`,
    )
    const bot = ctx.bots.find((item) => item.platform === binding.platform && item.selfId === binding.selfId)
    if (!bot) {
      logger.warn('[approval] 找不到对应的机器人实例，无法推送授权请求。')
      return
    }
    const content = [
      '请求授权',
      request.tool ? `工具：${request.tool}` : '',
      request.reason ? `原因：${request.reason}` : '',
      `会话：${binding.sessionId}`,
      '回复 dsh.approve 允许，dsh.deny 拒绝。',
    ]
      .filter(Boolean)
      .join('\n')
    bot.sendMessage(binding.channelId, content).catch((error: unknown) => {
      logger.warn(`[approval] 推送授权请求失败: ${getErrorMessage(error)}`)
    })
  })

  const deps = { ctx, config, client, store, listings, running, questions, deferred, chatMode, lastActive }

  // 提问：agent 在回合中主动向用户要选择，推回绑定过的聊天等待回答
  client.setQuestionHandler((request) => {
    const binding = store.findBySession(request.sessionId)
    if (!binding) {
      debugLog(config.debug, 'question', '没有对应的聊天绑定，跳过推送')
      return
    }
    debugLog(
      config.debug,
      'question',
      `推送到 ${binding.platform}:${binding.channelId} 共 ${request.questions.length} 个问题`,
    )
    const key = bindingKey(binding.platform, binding.selfId, binding.channelId)
    questions.set(key, {
      sessionId: request.sessionId,
      callId: request.eventId,
      questions: request.questions,
      at: Date.now(),
    })

    const bot = ctx.bots.find((item) => item.platform === binding.platform && item.selfId === binding.selfId)
    if (!bot) {
      logger.warn('[question] 找不到对应的机器人实例，无法推送提问。')
      return
    }
    bot.sendMessage(binding.channelId, renderQuestions(request.questions)).catch((error: unknown) => {
      logger.warn(`[question] 推送提问失败: ${getErrorMessage(error)}`)
    })
  })

  // 有待回答的提问时，先把它消费掉；这类消息不会再被当成新任务
  ctx.middleware(async (session, next) => {
    const text = stripChatMarkup(session.content ?? '')
    if (!text) return next()
    const answered = await answerPendingQuestion(deps, session, text)
    if (answered !== undefined) return answered
    return next()
  })

  // 私聊自然语言：只处理没有匹配任何指令的消息
  ctx.middleware((session, next) => {
    if (!shouldRunNaturalLanguage(deps, session)) return next()
    const text = stripChatMarkup(session.content ?? '')
    if (!text) return next()
    touchSession(deps, session)
    return handleRun(deps, session, text)
  })

  registerCommands(deps, config)

  // 配置页右侧的悬浮导航（客户端 Vue 组件）
  ctx.inject(['console'], (ctx) => {
    const console = (ctx as unknown as { console: { addEntry(entry: { dev: string; prod: string }): void } })
      .console
    console.addEntry({
      dev: join(__dirname, '../client/index.ts'),
      prod: join(__dirname, '../dist'),
    })
  })

  ctx.on('dispose', () => {
    client.dispose()
    store.dispose()
    listings.clear()
    running.clear()
    questions.clear()
    deferred.clear()
    chatMode.clear()
    lastActive.clear()
  })
}
