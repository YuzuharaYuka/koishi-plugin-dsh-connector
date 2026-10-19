import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { request } from 'node:http'
import {
  DISCOVER_CONCURRENCY,
  DISCOVER_MAX_CANDIDATES,
  DISCOVER_PROBE_TIMEOUT_MS,
  DSH_AUTH_MARK,
  DSH_BOOT_MARK,
} from '../constants'
import { logger } from '../utils'

export interface LoopbackListener {
  port: number
  processName: string
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '0.0.0.0', '[::]', '[::1]', '[::ffff:127.0.0.1]'])
/** 进程名命中这些关键字的监听优先探测，减少一次全量扫描的端口数 */
const PROCESS_HINTS = ['deepseek', 'dsh', 'electron', 'node']

/** 执行外部命令，失败一律当作「没有结果」，端口发现不该因平台差异抛错 */
function runCommand(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      resolve(error ? '' : stdout)
    })
  })
}

async function listWindowsListeners(): Promise<LoopbackListener[]> {
  const [netstat, tasklist] = await Promise.all([
    runCommand('netstat', ['-ano', '-p', 'tcp']),
    runCommand('tasklist', ['/fo', 'csv', '/nh']),
  ])

  const names = new Map<number, string>()
  for (const line of tasklist.split(/\r?\n/)) {
    const match = /^"(?<name>[^"]+)","(?<pid>\d+)"/.exec(line.trim())
    if (match?.groups) names.set(Number(match.groups.pid), match.groups.name.toLowerCase())
  }

  const listeners: LoopbackListener[] = []
  for (const line of netstat.split(/\r?\n/)) {
    const match = /^\s*TCP\s+(?<address>\S+):(?<port>\d+)\s+\S+\s+LISTENING\s+(?<pid>\d+)\s*$/i.exec(line)
    if (!match?.groups) continue
    if (!LOOPBACK_ADDRESSES.has(match.groups.address.trim())) continue
    const port = Number(match.groups.port)
    if (!Number.isInteger(port) || port <= 0) continue
    listeners.push({ port, processName: names.get(Number(match.groups.pid)) ?? '' })
  }
  return listeners
}

/** `/proc/net/tcp` 里的地址是小端十六进制，只关心回环与通配 */
function isLoopbackProcAddress(raw: string): boolean {
  if (raw.length === 8) {
    const ip = [0, 2, 4, 6].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16))
    const dotted = [ip[3], ip[2], ip[1], ip[0]].join('.')
    return dotted === '127.0.0.1' || dotted === '0.0.0.0'
  }
  if (raw.length === 32) {
    const tail = raw.slice(24)
    return raw === '0'.repeat(32) || tail === '01000000'
  }
  return false
}

async function listLinuxListeners(): Promise<LoopbackListener[]> {
  const listeners: LoopbackListener[] = []
  for (const file of ['/proc/net/tcp', '/proc/net/tcp6']) {
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      continue
    }
    for (const line of text.split('\n').slice(1)) {
      const columns = line.trim().split(/\s+/)
      // sl local_address rem_address st ...
      if (columns.length < 4 || columns[3] !== '0A') continue
      const [address, portHex] = columns[1].split(':')
      if (!address || !portHex || !isLoopbackProcAddress(address)) continue
      const port = Number.parseInt(portHex, 16)
      if (!Number.isInteger(port) || port <= 0) continue
      listeners.push({ port, processName: '' })
    }
  }
  return listeners
}

async function listMacListeners(): Promise<LoopbackListener[]> {
  const stdout = await runCommand('lsof', ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'n'])
  const listeners: LoopbackListener[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^n(?<address>.+):(?<port>\d+)$/.exec(line.trim())
    if (!match?.groups) continue
    const address = match.groups.address.trim()
    if (address !== '127.0.0.1' && address !== '*' && address !== '[::1]') continue
    const port = Number(match.groups.port)
    if (!Number.isInteger(port) || port <= 0) continue
    listeners.push({ port, processName: '' })
  }
  return listeners
}

export async function listLoopbackListeners(): Promise<LoopbackListener[]> {
  switch (process.platform) {
    case 'win32':
      return listWindowsListeners()
    case 'darwin':
      return listMacListeners()
    default:
      return listLinuxListeners()
  }
}

function looksLikeDsh(status: number | undefined, body: string): boolean {
  // DSH 未认证时固定回 401 + 这段文本，别的本地服务不会发
  if (body.includes(DSH_AUTH_MARK)) return true
  if (body.includes(DSH_BOOT_MARK)) return true
  return status === 200 && body.includes('DeepSeek Harness')
}

export function probePort(port: number, timeoutMs = DISCOVER_PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path: '/',
        method: 'GET',
        headers: {
          host: `127.0.0.1:${port}`,
          connection: 'close',
          'user-agent': 'koishi-plugin-dsh',
        },
        timeout: timeoutMs,
      },
      (res) => {
        let body = ''
        res.setEncoding('utf8')
        res.on('data', (chunk: string) => {
          if (body.length < 8192) body += chunk
        })
        res.on('end', () => resolve(looksLikeDsh(res.statusCode, body)))
        res.on('error', () => resolve(false))
      },
    )
    req.on('timeout', () => {
      req.destroy()
      resolve(false)
    })
    req.on('error', () => resolve(false))
    req.end()
  })
}

async function probeAll(ports: number[]): Promise<number[]> {
  const hits: number[] = []
  let cursor = 0
  const workerCount = Math.max(1, Math.min(DISCOVER_CONCURRENCY, ports.length))
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < ports.length) {
      const port = ports[cursor++]
      if (await probePort(port)) hits.push(port)
    }
  })
  await Promise.all(workers)
  return hits.sort((left, right) => left - right)
}

/**
 * 找到本机 DSH 网页服务的端口。
 *
 * `preferred` 是上一次成功的端口：DSH 只是重启时先探它，避免每次都跑一遍全量扫描。
 */
export async function discoverDshPort(preferred?: number): Promise<number | undefined> {
  if (preferred !== undefined && (await probePort(preferred))) {
    logger.debug(`[discover] 复用上次端口: ${preferred}`)
    return preferred
  }

  const listeners = await listLoopbackListeners()
  if (listeners.length === 0) return undefined

  const hinted = listeners.filter((item) => PROCESS_HINTS.some((hint) => item.processName.includes(hint)))
  const candidates = (hinted.length > 0 ? hinted : listeners).slice(0, DISCOVER_MAX_CANDIDATES)
  const ports = [...new Set(candidates.map((item) => item.port))]
  logger.debug(`[discover] 监听端口 ${listeners.length} 个，探测 ${ports.length} 个`)

  const hits = await probeAll(ports)
  if (hits.length === 0) return undefined
  logger.debug(`[discover] 命中端口: ${hits.join(', ')}`)
  return hits[0]
}
