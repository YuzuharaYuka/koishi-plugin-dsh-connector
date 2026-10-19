import { createHash, createHmac } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DSH_AUTH_COOKIE_PREFIX,
  DSH_AUTH_COOKIE_TTL_MS,
  DSH_AUTH_COOKIE_VERSION,
  DSH_BROWSER_SESSION_RECORD,
  DSH_CREDENTIALS_FILE,
  RELAY_ACCESS_COOKIE,
  RELAY_LOGIN_PATH,
} from '../constants'

export class DshAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DshAuthError'
  }
}

/** 配置优先，其次环境变量，最后 `~/.dsh` */
export function resolveDshHome(explicit: string): string {
  const candidate = explicit.trim() || (process.env.DSH_HOME ?? '').trim()
  return candidate || join(homedir(), '.dsh')
}

function base64url(buffer: Buffer): string {
  return buffer.toString('base64url')
}

function decodeSecret(raw: string): Buffer | null {
  const text = raw.trim()
  if (!text || !/^[A-Za-z0-9_-]+$/.test(text)) return null
  try {
    const decoded = Buffer.from(text, 'base64url')
    // 重新编码后可还原，说明是合法的 base64url，没有混入其它字符
    return decoded.length > 0 && base64url(decoded) === text ? decoded : null
  } catch {
    return null
  }
}

/**
 * 从 `.credentials.yaml` 中取出浏览器会话签名密钥。
 *
 * 该文件是「记录名 → 小型 YAML 块」的扁平映射，只按缩进扫描目标记录，
 * 这样不必为了一个字段引入 YAML 依赖，也不会把文件里的其它凭据带进内存之外的地方。
 */
export function parseBrowserSessionSecret(text: string): Buffer | null {
  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].trim() !== `${DSH_BROWSER_SESSION_RECORD}:`) continue
    const recordIndent = lines[index].search(/\S/)
    for (let cursor = index + 1; cursor < lines.length; cursor++) {
      const line = lines[cursor]
      const trimmed = line.trim()
      if (trimmed && line.search(/\S/) <= recordIndent) break
      if (!trimmed.startsWith('secret:')) continue
      const raw = trimmed.slice('secret:'.length).trim().replace(/^['"]|['"]$/g, '')
      return decodeSecret(raw)
    }
  }
  return null
}

export async function readBrowserSessionSecret(home: string): Promise<Buffer> {
  const file = join(home, DSH_CREDENTIALS_FILE)
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new DshAuthError(
      `读不到 DSH 凭据文件: ${file}。请确认 DSH 至少启动过一次，` +
      '或把配置项 `dshHome` 指向正在运行的 DSH 主目录（默认 `~/.dsh`）；' +
      '若 Koishi 与 DSH 不是同一个系统用户，还需要让该文件对 Koishi 可读。',
    )
  }
  const secret = parseBrowserSessionSecret(text)
  if (!secret) {
    throw new DshAuthError(
      `凭据文件里没有 ${DSH_BROWSER_SESSION_RECORD} 记录: ${file}。` +
      '请启动一次 DSH 网页服务，让它生成浏览器会话密钥。',
    )
  }
  return secret
}

/** 按 authority 现签一个 DSH 浏览器会话 cookie */
export function buildAuthCookie(secret: Buffer, authority: string, ttlMs = DSH_AUTH_COOKIE_TTL_MS): string {
  const now = Date.now()
  const payload = {
    version: DSH_AUTH_COOKIE_VERSION,
    authority,
    issuedAt: now,
    expiresAt: now + ttlMs,
  }
  const body = base64url(Buffer.from(JSON.stringify(payload), 'utf8'))
  const signature = base64url(createHmac('sha256', secret).update(body).digest())
  const name = DSH_AUTH_COOKIE_PREFIX + base64url(createHash('sha256').update(authority).digest())
  return `${name}=v1.${body}.${signature}`
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const single = headers.get('set-cookie')
  return single ? [single] : []
}

/**
 * relay 模式：用访问密钥换一个 `dsh-relay-access` cookie。
 *
 * relay 会自己给每个请求注入 DSH 的签名 cookie，因此这里不需要 DSH 的密钥。
 */
export async function loginRelay(baseUrl: string, accessKey: string, timeoutMs: number): Promise<string> {
  const url = `${baseUrl}${RELAY_LOGIN_PATH}${encodeURIComponent(accessKey)}`
  let response: Response
  try {
    response = await fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'text/html,application/json' },
    })
  } catch (error) {
    throw new DshAuthError(`连接 relay 失败: ${baseUrl}。请确认 relay 正在运行且地址可达 (${String(error)})。`)
  }

  if (response.status === 401 || response.status === 403) {
    throw new DshAuthError('relay 拒绝了访问密钥。请检查配置项 `accessKey` 是否与 `relay-config.json` 中的值一致。')
  }

  const cookie = readSetCookies(response)
    .map((item) => item.split(';')[0].trim())
    .find((item) => item.startsWith(`${RELAY_ACCESS_COOKIE}=`))

  if (!cookie) {
    if (response.status === 200) {
      throw new DshAuthError(
        'relay 返回了页面但没有下发访问 cookie。请确认 `baseUrl` 指向的是 DSH relay，而不是 DSH 本体。',
      )
    }
    throw new DshAuthError(
      `relay 没有下发访问 cookie (HTTP ${response.status})。请确认 \`baseUrl\` 与 \`accessKey\` 配置正确。`,
    )
  }

  return cookie
}
