import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface ChannelBinding {
  platform: string
  selfId: string
  channelId: string
  sessionId: string
  title: string
  updatedAt: number
}

export function bindingKey(platform: string, selfId: string, channelId: string): string {
  return `${platform}:${selfId}:${channelId}`
}

/**
 * 聊天窗口到 DSH 会话的绑定表。
 *
 * 落盘是为了让 Koishi 重启后授权请求仍然知道该推回哪个聊天；写入合并成一次，
 * 避免每条消息都刷盘。
 */
export class BindingStore {
  private readonly bindings = new Map<string, ChannelBinding>()
  private loaded = false
  private flushTimer?: NodeJS.Timeout

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    if (this.loaded) return
    this.loaded = true
    try {
      const text = await readFile(this.file, 'utf8')
      const parsed = JSON.parse(text) as { bindings?: ChannelBinding[] }
      for (const item of parsed.bindings ?? []) {
        if (!item || typeof item.sessionId !== 'string') continue
        this.bindings.set(bindingKey(item.platform, item.selfId, item.channelId), item)
      }
    } catch {
      // 首次运行没有文件，属于正常情况
    }
  }

  get(key: string): ChannelBinding | undefined {
    return this.bindings.get(key)
  }

  set(binding: Omit<ChannelBinding, 'updatedAt'>): ChannelBinding {
    const record: ChannelBinding = { ...binding, updatedAt: Date.now() }
    this.bindings.set(bindingKey(binding.platform, binding.selfId, binding.channelId), record)
    this.scheduleFlush()
    return record
  }

  remove(key: string): void {
    if (this.bindings.delete(key)) this.scheduleFlush()
  }

  findBySession(sessionId: string): ChannelBinding | undefined {
    for (const binding of this.bindings.values()) {
      if (binding.sessionId === sessionId) return binding
    }
    return undefined
  }

  list(): ChannelBinding[] {
    return [...this.bindings.values()]
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined
      void this.flush()
    }, 500)
  }

  async flush(): Promise<void> {
    const payload = JSON.stringify({ version: 1, bindings: this.list() }, null, 2)
    const temporary = `${this.file}.tmp`
    try {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(temporary, payload, 'utf8')
      await rename(temporary, this.file)
    } catch {
      // 绑定表写不进去不该影响聊天，失败只影响重启后的授权路由
    }
  }

  dispose(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = undefined
    }
    void this.flush()
  }
}
