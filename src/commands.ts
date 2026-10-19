import { h, type Session } from 'koishi'
import type { Config } from './config'
import {
  checkAccess,
  handleApproval,
  handleHistory,
  handleNew,
  handlePing,
  handlePermission,
  handleRun,
  handleSessions,
  handleStop,
  handleUse,
  handleWhoami,
  renderReply,
  type HandlerDeps,
} from './handlers'
import { getErrorMessage, logger } from './utils'

const HELP_TEXT = [
  '可用指令',
  '· dsh.ping：连接状态与当前绑定',
  '· dsh.sessions：会话列表，加 -a 显示全部',
  '· dsh.new [目录]：新建并绑定会话',
  '· dsh.use 序号：按序号或 ID 绑定',
  '· dsh.run 内容：交给 DSH 执行',
  '· dsh.stop：停止当前任务',
  '· dsh.history [条数]：回放最近回复',
  '· dsh.permission [预设]：查看或切换权限',
  '· dsh.approve / dsh.deny：处理授权',
  '· dsh.whoami：查看自己的标识',
].join('\n')

export function registerCommands(deps: HandlerDeps, config: Config): void {
  const { ctx } = deps

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
    if (!options?.ignoreAccess) {
      const denied = checkAccess(config, session)
      if (denied) return denied
    }
    // 指令可能早于 ready 触发，绑定表必须先从磁盘载入，否则会覆盖已有绑定
    return deps.store
      .load()
      .then(() => run(session))
      .then((result) => (typeof result === 'string' ? renderReply(config, result) : result))
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
    .option('all', '-a 包含子会话与空白会话')
    .usage('按工作目录分组并编号，回复 dsh.use 加序号即可绑定。\n默认隐藏子代理会话与从未使用过的空会话。')
    .example('dsh.sessions')
    .example('dsh.sessions -a')
    .action(({ session, options }) => action(session, (session) => handleSessions(deps, session, options?.all ?? false)))

  ctx.command('dsh.new [cwd:string]', '新建并绑定 DSH 会话')
    .alias('dsh新建')
    .usage('不带参数时使用 DSH 的默认工作目录；带参数时在该目录创建会话。')
    .example('dsh.new')
    .example('dsh.new D:\\AI\\workspace')
    .action(({ session }, cwd) => action(session, (session) => handleNew(deps, session, cwd ?? undefined)))

  ctx.command('dsh.use <target:string>', '绑定已有 DSH 会话')
    .alias('dsh切换')
    .usage('参数可以是 dsh.sessions 里的序号，也可以是完整会话 ID 或能唯一匹配的前缀。')
    .example('dsh.use 3')
    .example('dsh.use session-2fb91522')
    .action(({ session }, target) => action(session, (session) => handleUse(deps, session, target ?? '')))

  ctx.command('dsh.run <text:text>', '交给 DSH 执行并等待结果')
    .alias('dsh运行')
    .usage('内容和后面的所有文字一起提交给 DSH，消息附带的图片也会一并提交。\n未绑定会话时会自动新建一个。')
    .example('dsh.run 列出当前目录下的文件')
    .action(({ session }, text) => action(session, (session) => handleRun(deps, session, text ?? '')))

  ctx.command('dsh.stop', '停止当前任务')
    .alias('dsh停止')
    .action(({ session }) => action(session, (session) => handleStop(deps, session)))

  ctx.command('dsh.history [count:number]', '回放最近的助手回复')
    .alias('dsh历史')
    .usage('条数受配置项 historyLimit 约束。')
    .example('dsh.history 3')
    .action(({ session }, count) => action(session, (session) => handleHistory(deps, session, count)))

  ctx.command('dsh.permission [preset:string]', '查看或切换权限预设')
    .alias('dsh权限')
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
