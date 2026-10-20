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

/** 统一的 HTTP 层错误映射 */
function assertStatus(response: Response, method: string): void {
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
}

function buildEnvelope(method: string, args: Record<string, unknown>): RpcEnvelope {
  return {
    type: 'client-request',
    rpcId: randomUUID(),
    method,
    payload: { args },
  }
}

function post(baseUrl: string, cookie: string, method: string, args: Record<string, unknown>, timeoutMs: number) {
  return (async () => {
    let response: Response
    try {
      response = await fetch(`${baseUrl}/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: JSON.stringify(buildEnvelope(method, args)),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new DshRpcError(`连接 DSH 失败: ${baseUrl} (${reason})`, 'network', 0)
    }
    assertStatus(response, method)
    return response
  })()
}

function unwrap(body: RpcResponse, method: string): unknown {
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

/** DSH 的 Typert 网关：`POST /api/<namespace>/<method>`，请求体带 `{ args }` */
export async function callRpc(options: RpcOptions): Promise<unknown> {
  const { baseUrl, cookie, method, args = {}, timeoutMs } = options
  const response = await post(baseUrl, cookie, method, args, timeoutMs)

  let body: RpcResponse
  try {
    body = (await response.json()) as RpcResponse
  } catch {
    throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, 'malformed', 200)
  }
  return unwrap(body, method)
}

/**
 * 结果里含二进制（Uint8Array）的接口会返回 multipart/form-data：
 * 每个二进制字段一个分片，另有 `metadata` 放 JSON 结果信封。
 */
export async function callRpcMultipart(
  options: RpcOptions,
): Promise<{ value: unknown; parts: Map<string, Buffer> }> {
  const { baseUrl, cookie, method, args = {}, timeoutMs } = options
  const response = await post(baseUrl, cookie, method, args, timeoutMs)

  let form: FormData
  try {
    form = await response.formData()
  } catch {
    throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, 'malformed', 200)
  }

  const parts = new Map<string, Buffer>()
  let metadata: RpcResponse | undefined

  for (const [name, value] of form.entries()) {
    if (typeof value === 'string') {
      if (name === 'metadata') {
        try {
          metadata = JSON.parse(value) as RpcResponse
        } catch {
          throw new DshRpcError(`DSH 返回了无法解析的响应 (${method})`, 'malformed', 200)
        }
      }
      continue
    }
    parts.set(name, Buffer.from(await value.arrayBuffer()))
  }

  if (!metadata) throw new DshRpcError(`DSH 返回了意外响应 (${method})`, 'malformed', 200)
  return { value: unwrap(metadata, method), parts }
}
