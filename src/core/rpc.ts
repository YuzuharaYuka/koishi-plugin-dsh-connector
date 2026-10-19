import { randomUUID } from 'node:crypto'

export class DshRpcError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'DshRpcError'
  }
}

interface RpcEnvelope {
  type: 'client-request'
  rpcId: string
  method: string
  payload: { args: Record<string, unknown> }
}

interface RpcResponse {
  type?: string
  result?: {
    ok?: boolean
    value?: unknown
    error?: { code?: string; message?: string; details?: unknown }
  }
}

export interface RpcOptions {
  baseUrl: string
  cookie: string
  method: string
  args?: Record<string, unknown>
  timeoutMs: number
}

/** DSH 的 Typert 网关：`POST /api/<namespace>/<method>`，请求体带 `{ args }` */
export async function callRpc(options: RpcOptions): Promise<unknown> {
  const { baseUrl, cookie, method, args = {}, timeoutMs } = options
  const envelope: RpcEnvelope = {
    type: 'client-request',
    rpcId: randomUUID(),
    method,
    payload: { args },
  }

  let response: Response
  try {
    response = await fetch(`${baseUrl}/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new DshRpcError(`连接 DSH 失败: ${baseUrl} (${reason})`, 'network', 0)
  }

  if (response.status === 401) {
    throw new DshRpcError('DSH 拒绝了请求 (401)，浏览器会话凭据无效或已过期', 'unauthorized', 401)
  }
  if (response.status === 403) {
    throw new DshRpcError(
      'DSH 拒绝了请求 (403)，Host 校验未通过。请把地址写成回环地址，或给 `dsh web` 加 `--trusted-host`',
      'forbidden',
      403,
    )
  }
  if (response.status === 404) {
    throw new DshRpcError(
      `DSH 不支持接口 ${method} (404)，可能是 DSH 版本与插件不匹配`,
      'unsupported',
      404,
    )
  }
  if (response.status === 503) {
    throw new DshRpcError('DSH 网页服务尚未就绪 (503)，请稍候重试', 'starting', 503)
  }
  if (response.status !== 200) {
    throw new DshRpcError(`DSH 返回 HTTP ${response.status}`, 'http', response.status)
  }

  let body: RpcResponse
  try {
    body = (await response.json()) as RpcResponse
  } catch {
    throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, 'malformed', 200)
  }

  const result = body.result
  if (!result || typeof result !== 'object') {
    throw new DshRpcError(`DSH 返回了意外响应 (${method})`, 'malformed', 200)
  }
  if (result.ok !== true) {
    const code = result.error?.code ?? 'unknown'
    const message = result.error?.message ?? '未知错误'
    throw new DshRpcError(`DSH 错误 ${code}: ${message}`, String(code), 200)
  }
  return result.value
}
