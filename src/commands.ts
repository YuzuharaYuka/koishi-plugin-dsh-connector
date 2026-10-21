import { h, type Session } from 'koishi'
import type { Config } from './config'
import {
  checkAccess,
  handleApproval,
  handleArchive,
  handleBalance,
  handleChatMode,
  handleContextCommand,
  handleGet,
  handleHistory,
  handleModel,
  handleNew,
  handlePing,
  handlePermission,
  handleRun,
  handleSessions,
  handleSteer,
  handleStop,
  handleThink,
  handleUse,
  handleWhoami,
  handleWorkspaces,
  renderReply,
  touchSession,
  type HandlerDeps,
} from './handlers'
import { debugLog, getErrorMessage, logger } from './utils'

const HELP_TEXT = [
  '可用指令',
  '· dsh.ping：连接状态与当前绑定',
  '· dsh.sessions：会话列表，加 -a 显示全部',
  '· dsh.new [目录/序号]：新建并绑定会话',
  '· dsh.workspaces：列出已知工作区',
  '· dsh.use 序号：按序号或 ID 绑定',
  '· dsh.run 内容：交给 DSH 执行',
  '· dsh.steer 内容：往运行中的任务补充指令',
  '· dsh.compact / dsh.clear：压缩或清空上下文',
  '· dsh.chat on/off：私聊自然语言模式',
  '· dsh.stop：停止当前任务',
  '· dsh.history [条数]：回放最近回复',
  '· dsh.archive / dsh.unarchive：归档或恢复会话',
  '· dsh.model [序号] [等级]：查看或切换模型',
  '· dsh.think [等级]：调整思考等级',
  '· dsh.get 路径：取回工作区文件',
  '· dsh.balance：查看账户余额',
  '· dsh.permission [预设]：查看或切换权限',
  '· dsh.approve / dsh.deny：处理授权',
  '· dsh.whoami：查看自己的标识',
].join('\n')

export function registerCommands(deps: HandlerDeps, config: Config): void {
  const { ctx } = deps

  /** 发信人是不是本进程里已知的机器人账号 */
  const isBotSender = (session: Session): boolean => {
    if (session.userId && session.userId === session.selfId) return true
    return ctx.bots.some((bot) => bot.platform === session.platform && bot.selfId === session.userId)
  }

  /**
   * 统一出口：先判权限，再把字符串结果过一遍纯文本转换，最后兜住异常。
   *
   * 固定文案本身已不含 Markdown，但用户输入或配置可能带进来，统一在这里收口。
   */
  const action = (
    session: Session | undefined,
    run: (session: Session) => Promise<h.Fragment>,
    options?: { ignoreAccess?: boolean },
  ) => {
    if (!session) return ''
    // 机器人不该驱动 DSH：忽略机器人发来的消息，避免两个 bot 互相触发
    if (isBotSender(session)) return ''
    debugLog(config.debug, 'command', `${session.platform}:${session.userId} 触发 ${(session.content ?? '').slice(0, 80)}`)
    if (!options?.ignoreAccess) {
      const denied = checkAccess(config, session)
      if (denied) return denied
    }
    // 指令可能早于 ready 触发，绑定表必须先从磁盘载入，否则会覆盖已有绑定
    return deps.store
      .load()
      .then(() => run(session))
      .then((result) => {
        touchSession(deps, session)
        return typeof result === 'string' ? renderReply(config, result) : result
      })
      .catch((error: unknown) => {
        const message = getErrorMessage(error)
        logger.warn(`[command] 指令执行失败: ${message}`)
        // 错误文案也可能带 Markdown 或尖括号，同样按聊天格式收口
        return renderReply(config, `执行失败：${message}`)
      })
  }

  ctx.command('dsh', 'DeepSeek Harness 控制')
    .usage('按聊天窗口绑定 DSH 会话，把任务交给本机 DSH 执行。\n\n' + HELP_TEXT)
    .action(({ session }) => action(session, () => Promise.resolve(HELP_TEXT)))

  ctx.command('dsh.ping', '检查 DSH 连接')
    .alias('dsh状态')
    .action(({ session }) => action(session, (session) => handlePing(deps, session)))

  ctx.command('dsh.sessions', '列出 DSH 会话')
    .alias('dsh会话')
    .option('all', '-a 包含子会话、空白会话与已归档会话')
    .usage(
      '按 DSH 里的工作区分组，组名就是工作区名；不在任何工作区的会话归入「未分组」。\n' +
      '分组、排序与归档筛选由配置项 sessionGroupBy / sessionSortBy / sessionFilter 控制；-a 强制显示全部。',
    )
    .example('dsh.sessions')
    .example('dsh.sessions -a')
    .action(({ session, options }) => action(session, (session) => handleSessions(deps, session, options?.all ?? false)))

  ctx.command('dsh.new [target:string]', '新建并绑定 DSH 会话')
    .alias('dsh新建')
    .usage(
      '参数可以是 dsh.workspaces 里的序号、绝对路径，或省略。\n' +
      '省略时使用配置项 defaultWorkspace，未配置则用 DSH 默认目录。',
    )
    .example('dsh.new')
    .example('dsh.new 2')
    .example('dsh.new D:\\AI\\workspace')
    .action(({ session }, target) => action(session, (session) => handleNew(deps, session, target ?? undefined)))

  ctx.command('dsh.workspaces', '列出已知工作区')
    .alias('dsh工作区')
    .usage('按现有会话的目录归纳，按最近使用排序；可直接把序号交给 dsh.new。')
    .action(({ session }) => action(session, () => handleWorkspaces(deps)))

  ctx.command('dsh.model [target:string] [effort:string]', '查看或切换模型')
    .alias('dsh模型')
    .usage(
      '不带参数列出可用模型与当前选择。\n' +
      '带序号或模型名切换，第二个参数可同时设置思考等级（off / low / high / max）。',
    )
    .example('dsh.model')
    .example('dsh.model 2')
    .example('dsh.model 2 max')
    .action(({ session }, target, effort) =>
      action(session, (session) => handleModel(deps, session, target ?? undefined, effort ?? undefined)),
    )

  ctx.command('dsh.think [effort:string]', '调整思考等级')
    .alias('dsh思考')
    .usage('只改思考等级，模型保持不变；不带参数查看当前等级与可选值。')
    .example('dsh.think')
    .example('dsh.think high')
    .action(({ session }, effort) => action(session, (session) => handleThink(deps, session, effort ?? undefined)))

  ctx.command('dsh.steer <text:text>', '给运行中的任务补充指令')
    .alias('dsh插话')
    .usage('任务正在执行时把内容注入当前回合；没有任务在跑就按普通 dsh.run 处理。')
    .example('dsh.steer 顺便把测试也跑一下')
    .action(({ session }, text) => action(session, (session) => handleSteer(deps, session, text ?? '')))

  ctx.command('dsh.compact', '压缩当前会话的上下文')
    .alias('dsh压缩')
    .usage('调用 DSH 自带的 /compact，较早的历史会被摘要，会话与绑定不变。')
    .action(({ session }) => action(session, (session) => handleContextCommand(deps, session, 'compact')))

  ctx.command('dsh.clear', '清空当前会话的上下文')
    .alias('dsh清空')
    .usage('调用 DSH 自带的 /clear，保留会话绑定与历史记录，只清空模型上下文。')
    .action(({ session }) => action(session, (session) => handleContextCommand(deps, session, 'clear')))

  ctx.command('dsh.chat [action:string]', '私聊自然语言模式')
    .alias('dsh对话')
    .usage(
      '不带参数查看状态。\n' +
      '开启后私聊里不带指令前缀的消息会直接交给 DSH；dsh.* 指令仍然优先。',
    )
    .example('dsh.chat')
    .example('dsh.chat on')
    .example('dsh.chat off')
    .action(({ session }, value) =>
      action(session, (session) => Promise.resolve(handleChatMode(deps, session, value))),
    )

  ctx.command('dsh.get <path:string>', '取回工作区里的文件')
    .alias('dsh取文件')
    .usage('路径相对当前会话的工作区，例如 src/index.ts。单个文件受配置项 maxFileMb 限制。')
    .example('dsh.get dist/report.md')
    .action(({ session }, path) => action(session, (session) => handleGet(deps, session, path ?? undefined)))

  ctx.command('dsh.balance', '查看账户余额')
    .alias('dsh余额')
    .usage('读取 DSH 登录的 DeepSeek 平台账户余额；未登录平台账号时不可用。')
    .action(({ session }) => action(session, () => handleBalance(deps)))

  ctx.command('dsh.use <target:string>', '绑定已有 DSH 会话')
    .alias('dsh切换')
    .usage('参数可以是 dsh.sessions 里的序号，也可以是完整会话 ID 或能唯一匹配的前缀。')
    .example('dsh.use 3')
    .example('dsh.use session-2fb91522')
    .action(({ session }, target) => action(session, (session) => handleUse(deps, session, target ?? '')))

  ctx.command('dsh.run <text:text>', '交给 DSH 执行并等待结果')
    .alias('dsh运行')
    .usage(
      '内容和后面的所有文字一起提交给 DSH，消息附带的图片也会一并提交。\n' +
      'QQ 无法把文字和文件放进同一条消息：引用一条带附件的消息再发本指令，即可把该附件一起带上。\n' +
      '未绑定会话时会自动新建一个。',
    )
    .example('dsh.run 列出当前目录下的文件')
    .example('（引用一个文件后）dsh.run 把这个文件转成 pdf')
    .action(({ session }, text) => action(session, (session) => handleRun(deps, session, text ?? '')))

  ctx.command('dsh.archive [target:string]', '归档会话')
    .alias('dsh归档')
    .usage('参数可以是会话列表里的序号、会话 ID 或唯一前缀；省略时归档当前绑定的会话。')
    .example('dsh.archive')
    .example('dsh.archive 3')
    .action(({ session }, target) =>
      action(session, (session) => handleArchive(deps, session, target ?? undefined, true)),
    )

  ctx.command('dsh.unarchive [target:string]', '取消归档')
    .alias('dsh取消归档')
    .usage('把会话从归档里恢复；参数规则与 dsh.archive 相同。')
    .example('dsh.unarchive 3')
    .action(({ session }, target) =>
      action(session, (session) => handleArchive(deps, session, target ?? undefined, false)),
    )

  ctx.command('dsh.stop', '停止当前任务')
    .alias('dsh停止')
    .action(({ session }) => action(session, (session) => handleStop(deps, session)))

  ctx.command('dsh.history [count:number]', '回放最近的助手回复')
    .alias('dsh历史')
    .usage('条数受配置项 historyLimit 约束。')
    .example('dsh.history 3')
    .action(({ session }, count) => action(session, (session) => handleHistory(deps, session, count)))

  ctx.command('dsh.permission [preset:string]', '查看或切换权限预设')    .alias('dsh权限')
    .usage(
      '预设同时决定沙箱模式与审批策略：\n' +
      'read-only 仅可查看、workspace-write 工作区可写、danger-full-access 完全权限、auto 自动审查。\n' +
      '不带参数查看当前权限。',
    )
    .example('dsh.permission')
    .example('dsh.permission read-only')
    .action(({ session }, preset) =>
      action(session, (session) => handlePermission(deps, session, preset ?? undefined)),
    )

  ctx.command('dsh.approve', '允许当前的授权请求')
    .alias('dsh允许')
    .action(({ session }) => action(session, (session) => handleApproval(deps, session, 'allow')))

  ctx.command('dsh.deny', '拒绝当前的授权请求')
    .alias('dsh拒绝')
    .action(({ session }) => action(session, (session) => handleApproval(deps, session, 'deny')))

  ctx.command('dsh.whoami', '查看自己的用户标识')
    .alias('dsh我是谁')
    .usage('未在名单中的用户也能用它查看标识，把标识填进配置项 allowUsers 即可放行。')
    .action(({ session }) =>
      action(session, (session) => Promise.resolve(handleWhoami(deps, session)), { ignoreAccess: true }),
    )
}
