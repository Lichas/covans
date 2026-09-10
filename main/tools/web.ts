import http from 'node:http'
import https from 'node:https'
import {
  brotliDecompressSync,
  gunzipSync,
  inflateSync,
} from 'node:zlib'
import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const MAX_REDIRECTS = 5
const MAX_WIRE_BYTES = 1024 * 1024
const MAX_DECODED_BYTES = 2 * 1024 * 1024
const MAX_MODEL_CHARS = 100_000
const MAX_SEARCH_TITLE_CHARS = 300
const MAX_SEARCH_SNIPPET_CHARS = 1_200
const REQUEST_TIMEOUT_MS = 20_000
const BROWSER_TIMEOUT_MS = 30_000
const USER_AGENT = 'Covan/0.1 (+local AI assistant; read-only web tool)'

interface PublicTextResponse {
  finalUrl: string
  contentType: string
  text: string
}

export interface WebNetworkAdapter {
  fetch?(url: string, init: RequestInit): Promise<Response>
  renderPage?(
    url: string,
    signal?: AbortSignal,
  ): Promise<BrowserRenderedPage>
}

export interface BrowserRenderedPage {
  finalUrl: string
  title: string
  text: string
  links: Array<{ label: string; url: string }>
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebSearchRequest {
  query: string
  limit: number
  language: string
}

export interface WebSearchProvider {
  readonly id: string
  search(
    request: WebSearchRequest,
    signal?: AbortSignal,
  ): Promise<WebSearchResult[]>
}

interface RequestResponse {
  status: number
  headers: http.IncomingHttpHeaders
  body: Buffer
  decoded?: boolean
}

const nodeNetworkAdapter: WebNetworkAdapter = {}

let defaultNetworkAdapter = nodeNetworkAdapter

export function configureWebNetworkAdapter(
  adapter?: WebNetworkAdapter,
): void {
  defaultNetworkAdapter = adapter ?? nodeNetworkAdapter
}

function textResult(text: string, details: unknown = {}) {
  return { content: [{ type: 'text' as const, text }], details }
}

function parseHttpUrl(rawUrl: string): URL {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('URL 无效：请提供完整的 http:// 或 https:// 地址')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error('URL 只允许 http:// 或 https:// 协议')
  if (url.username || url.password)
    throw new Error('URL 不得包含用户名或密码')
  return url
}

async function requestOnce(
  url: URL,
  signal?: AbortSignal,
  adapter: WebNetworkAdapter = defaultNetworkAdapter,
): Promise<RequestResponse> {
  signal?.throwIfAborted()
  if (adapter.fetch) return requestWithAdapter(url, adapter.fetch, signal)
  const transport = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (error?: Error, value?: RequestResponse) => {
      if (settled) return
      settled = true
      if (error) reject(error)
      else resolve(value!)
    }
    const request = transport.request(
      url,
      {
        method: 'GET',
        signal,
        headers: {
          Accept:
            'text/html,application/xhtml+xml,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
          'User-Agent': USER_AGENT,
        },
      },
      (response) => {
        const declared = Number(response.headers['content-length'] || 0)
        if (declared > MAX_WIRE_BYTES) {
          response.resume()
          finish(new Error('网页响应超过 1MB 限制'))
          return
        }
        const chunks: Buffer[] = []
        let size = 0
        response.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > MAX_WIRE_BYTES) {
            response.destroy(new Error('网页响应超过 1MB 限制'))
            return
          }
          chunks.push(chunk)
        })
        response.on('end', () =>
          finish(undefined, {
            status: response.statusCode || 0,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        )
        response.on('error', (error) => finish(error))
      },
    )
    request.on('error', (error) => finish(error))
    request.end()
  })
}

async function requestWithAdapter(
  url: URL,
  fetchWithSystemNetwork: NonNullable<WebNetworkAdapter['fetch']>,
  signal?: AbortSignal,
): Promise<RequestResponse> {
  const response = await fetchWithSystemNetwork(url.toString(), {
    method: 'GET',
    redirect: 'manual',
    signal,
    credentials: 'omit',
    headers: {
      Accept:
        'text/html,application/xhtml+xml,application/json,application/xml,text/plain;q=0.9,*/*;q=0.1',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.7',
      'User-Agent': USER_AGENT,
    },
  })
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > MAX_DECODED_BYTES) throw new Error('网页响应超过 2MB 限制')
  const reader = response.body?.getReader()
  const chunks: Buffer[] = []
  let size = 0
  if (reader) {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > MAX_DECODED_BYTES) {
        await reader.cancel('网页响应超过 2MB 限制')
        throw new Error('网页响应超过 2MB 限制')
      }
      chunks.push(Buffer.from(chunk.value))
    }
  }
  const headers: http.IncomingHttpHeaders = {}
  for (const name of ['content-type', 'location']) {
    const value = response.headers.get(name)
    if (value !== null) headers[name] = value
  }
  return {
    status: response.status,
    headers,
    body: Buffer.concat(chunks),
    decoded: true,
  }
}

function decodeBody(body: Buffer, encoding: string | undefined): Buffer {
  const options = { maxOutputLength: MAX_DECODED_BYTES }
  switch ((encoding || '').toLowerCase()) {
    case 'gzip':
      return gunzipSync(body, options)
    case 'deflate':
      return inflateSync(body, options)
    case 'br':
      return brotliDecompressSync(body, options)
    case '':
    case 'identity':
      return body
    default:
      throw new Error(`不支持的内容压缩方式：${encoding}`)
  }
}

async function fetchPublicText(
  rawUrl: string,
  signal?: AbortSignal,
  adapter: WebNetworkAdapter = defaultNetworkAdapter,
): Promise<PublicTextResponse> {
  const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const requestSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal
  try {
    let url = parseHttpUrl(rawUrl)
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await requestOnce(url, requestSignal, adapter)
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.location
        if (!location)
          throw new Error(`网页返回 HTTP ${response.status}，但缺少跳转地址`)
        if (redirect === MAX_REDIRECTS) throw new Error('网页跳转次数过多')
        url = parseHttpUrl(new URL(location, url).toString())
        continue
      }
      if (response.status < 200 || response.status >= 300)
        throw new Error(`网页请求失败：HTTP ${response.status}`)
      const contentType = String(response.headers['content-type'] || '')
        .split(';')[0]
        .trim()
        .toLowerCase()
      const textual =
        contentType.startsWith('text/') ||
        /^(application\/(json|xml|xhtml\+xml|rss\+xml|atom\+xml))$/.test(
          contentType,
        )
      if (!textual)
        throw new Error(
          `仅支持文本网页，当前响应为 ${contentType || '未知类型'}`,
        )
      const decoded = response.decoded
        ? response.body
        : decodeBody(
            response.body,
            Array.isArray(response.headers['content-encoding'])
              ? response.headers['content-encoding'][0]
              : response.headers['content-encoding'],
          )
      if (decoded.length > MAX_DECODED_BYTES)
        throw new Error('网页解压后超过 2MB 限制')
      return {
        finalUrl: url.toString(),
        contentType,
        text: decoded.toString('utf8'),
      }
    }
    throw new Error('网页跳转次数过多')
  } catch (error) {
    signal?.throwIfAborted()
    if (timeoutSignal.aborted)
      throw new Error(`网页请求超时（${REQUEST_TIMEOUT_MS / 1000} 秒）`)
    throw error
  }
}

function decodeEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"',
  }
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (entity, code: string) => {
      if (code.startsWith('#x'))
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16))
      if (code.startsWith('#'))
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10))
      return named[code.toLowerCase()] ?? entity
    },
  )
}

function stripTags(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function htmlToReadableText(html: string, baseUrl: string): string {
  let value = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript|template)[^>]*>[\s\S]*?<\/\1>/gi, '')
  value = value.replace(
    /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_match, href: string, label: string) => {
      const text = stripTags(label)
      if (!text) return ''
      try {
        const absolute = new URL(decodeEntities(href), baseUrl)
        if (absolute.protocol !== 'http:' && absolute.protocol !== 'https:')
          return text
        return `[${text}](${absolute.toString()})`
      } catch {
        return text
      }
    },
  )
  value = value
    .replace(/<h([1-6])[^>]*>/gi, (_match, level: string) => `\n${'#'.repeat(Number(level))} `)
    .replace(/<\/(h[1-6]|p|div|section|article|header|footer|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/(li|ul|ol)>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
  return decodeEntities(value)
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function renderFetched(response: PublicTextResponse) {
  let content = response.text
  if (response.contentType.includes('html'))
    content = htmlToReadableText(content, response.finalUrl)
  else if (response.contentType === 'application/json') {
    try {
      content = JSON.stringify(JSON.parse(content), null, 2)
    } catch {
      // Keep malformed JSON as text so the model can still inspect it.
    }
  }
  const truncated = content.length > MAX_MODEL_CHARS
  if (truncated)
    content = `${content.slice(0, MAX_MODEL_CHARS)}\n\n[内容已截断，原文共 ${content.length} 字符]`
  return { content, truncated }
}

function shouldRenderWithBrowser(
  response: PublicTextResponse,
  readableContent: string,
): boolean {
  if (!response.contentType.includes('html')) return false
  const html = response.text.toLowerCase()
  const hasScripts = /<script\b/.test(html)
  const hasAppShell =
    /id=["'](?:root|app|__next)["']/.test(html) ||
    /__next_data__|webpack|javascript (?:is )?required|enable javascript/.test(
      html,
    )
  return hasScripts && (readableContent.length < 1_500 || (hasAppShell && readableContent.length < 5_000))
}

function renderBrowserPage(page: BrowserRenderedPage) {
  const links = page.links
    .slice(0, 100)
    .map((link) => `- [${link.label}](${link.url})`)
    .join('\n')
  let content = [page.title ? `# ${page.title}` : '', page.text, links]
    .filter(Boolean)
    .join('\n\n')
  const truncated = content.length > MAX_MODEL_CHARS
  if (truncated)
    content = `${content.slice(0, MAX_MODEL_CHARS)}\n\n[渲染后内容已截断]`
  return { content, truncated }
}

async function browserRenderWithTimeout(
  adapter: WebNetworkAdapter,
  url: string,
  signal?: AbortSignal,
): Promise<BrowserRenderedPage> {
  if (!adapter.renderPage) throw new Error('当前环境不支持 JavaScript 网页渲染')
  const timeoutSignal = AbortSignal.timeout(BROWSER_TIMEOUT_MS)
  const renderSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal
  try {
    return await adapter.renderPage(url, renderSignal)
  } catch (error) {
    signal?.throwIfAborted()
    if (timeoutSignal.aborted)
      throw new Error(`网页 JavaScript 渲染超时（${BROWSER_TIMEOUT_MS / 1000} 秒）`)
    throw error
  }
}

function xmlElement(block: string, name: string): string {
  const match = block.match(new RegExp(`<${name}>([\\s\\S]*?)<\\/${name}>`, 'i'))
  return match ? stripTags(match[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')) : ''
}

function parseBingRss(xml: string, limit: number): WebSearchResult[] {
  const results: WebSearchResult[] = []
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const title = xmlElement(match[1], 'title')
    const url = xmlElement(match[1], 'link')
    const snippet = xmlElement(match[1], 'description')
    if (title && /^https?:\/\//i.test(url))
      results.push({ title, url, snippet })
    if (results.length >= limit) break
  }
  return results
}

function normalizeSearchResults(
  value: unknown,
  limit: number,
): WebSearchResult[] {
  if (!Array.isArray(value)) throw new Error('搜索 provider 返回了无效结果')
  const results: WebSearchResult[] = []
  const maxCandidates = Math.min(value.length, Math.max(limit * 5, 10), 50)
  for (const candidate of value.slice(0, maxCandidates)) {
    if (!candidate || typeof candidate !== 'object') continue
    const item = candidate as Partial<WebSearchResult>
    const title = typeof item.title === 'string' ? item.title.trim() : ''
    const snippet =
      typeof item.snippet === 'string' ? item.snippet.trim() : ''
    if (!title || typeof item.url !== 'string') continue
    let url: URL
    try {
      url = parseHttpUrl(item.url)
    } catch {
      continue
    }
    results.push({
      title: title.slice(0, MAX_SEARCH_TITLE_CHARS),
      url: url.toString(),
      snippet: snippet.slice(0, MAX_SEARCH_SNIPPET_CHARS),
    })
    if (results.length >= limit) break
  }
  return results
}

export function createBingRssSearchProvider(
  networkAdapter: WebNetworkAdapter = defaultNetworkAdapter,
): WebSearchProvider {
  return {
    id: 'bing-rss',
    async search(request, signal) {
      const url = new URL('https://www.bing.com/search')
      url.searchParams.set('format', 'rss')
      url.searchParams.set('q', request.query)
      url.searchParams.set('setlang', request.language)
      const response = await fetchPublicText(
        url.toString(),
        signal,
        networkAdapter,
      )
      return parseBingRss(response.text, request.limit)
    },
  }
}

export interface WebToolOptions {
  searchProvider?: WebSearchProvider
  networkAdapter?: WebNetworkAdapter
}

export function createWebTools(options: WebToolOptions = {}): AgentTool[] {
  let searches = 0
  let fetches = 0
  const networkAdapter = options.networkAdapter ?? defaultNetworkAdapter
  const searchProvider =
    options.searchProvider ?? createBingRssSearchProvider(networkAdapter)
  const webFetch: AgentTool = {
    name: 'web_fetch',
    label: '读取网页',
    description:
      '读取一个 http/https URL，将 HTML 转为可读文本。只读、不带登录态，使用系统网络与代理设置，不支持 PDF/图片/视频。需要先找 URL 时用 web_search。',
    parameters: Type.Object({
      url: Type.String({
        minLength: 8,
        maxLength: 2048,
        description: '完整的 http:// 或 https:// URL',
      }),
      render: Type.Optional(
        Type.Union(
          [Type.Literal('auto'), Type.Literal('always'), Type.Literal('never')],
          {
            description:
              '默认 auto：动态页自动用 Chromium 执行 JavaScript；always 强制渲染；never 仅抓静态 HTML',
          },
        ),
      ),
    }),
    execute: async (_id, params, signal) => {
      if (++fetches > 10) throw new Error('本轮最多读取 10 个网页')
      const p = params as {
        url: string
        render?: 'auto' | 'always' | 'never'
      }
      const requestedUrl = parseHttpUrl(p.url).toString()
      const renderMode = p.render ?? 'auto'
      let finalUrl = requestedUrl
      let contentType = 'text/html'
      let rendered!: { content: string; truncated: boolean }
      let usedBrowser = false
      if (renderMode === 'always') {
        const page = await browserRenderWithTimeout(
          networkAdapter,
          requestedUrl,
          signal,
        )
        finalUrl = parseHttpUrl(page.finalUrl).toString()
        rendered = renderBrowserPage(page)
        usedBrowser = true
      } else {
        let response: PublicTextResponse | undefined
        try {
          response = await fetchPublicText(
            requestedUrl,
            signal,
            networkAdapter,
          )
        } catch (error) {
          if (renderMode === 'never' || !networkAdapter.renderPage) throw error
          const page = await browserRenderWithTimeout(
            networkAdapter,
            requestedUrl,
            signal,
          )
          finalUrl = parseHttpUrl(page.finalUrl).toString()
          rendered = renderBrowserPage(page)
          usedBrowser = true
        }
        if (response) {
          finalUrl = response.finalUrl
          contentType = response.contentType
          rendered = renderFetched(response)
          if (
            renderMode === 'auto' &&
            networkAdapter.renderPage &&
            shouldRenderWithBrowser(response, rendered.content)
          ) {
            const page = await browserRenderWithTimeout(
              networkAdapter,
              response.finalUrl,
              signal,
            )
            finalUrl = parseHttpUrl(page.finalUrl).toString()
            rendered = renderBrowserPage(page)
            usedBrowser = true
          }
        }
      }
      return textResult(
        `# ${finalUrl}\n\n${rendered.content}`,
        {
          url: finalUrl,
          contentType,
          renderMode: usedBrowser ? 'browser' : 'static',
          truncated: rendered.truncated,
        },
      )
    },
    replay: 'safe',
  }

  const webSearch: AgentTool = {
    name: 'web_search',
    label: '搜索网页',
    description:
      '搜索公开网页以获取实时或需要核实的信息，返回标题、摘要和 URL。搜索后如需要核实原文，再用 web_fetch 打开最相关的结果。回答中应保留来源链接。',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      language: Type.Optional(
        Type.String({
          pattern: '^[a-z]{2}(?:-[A-Z]{2})?$',
          description: '结果语言，如 zh-CN 或 en-US',
        }),
      ),
    }),
    execute: async (_id, params, signal) => {
      if (++searches > 5) throw new Error('本轮最多搜索 5 次')
      const p = params as { query: string; limit?: number; language?: string }
      const limit = p.limit ?? 5
      const language = p.language ?? 'zh-CN'
      const results = normalizeSearchResults(
        await searchProvider.search({ query: p.query, limit, language }, signal),
        limit,
      )
      if (results.length === 0)
        throw new Error('搜索服务未返回可用结果，请换一组关键词')
      return textResult(
        results
          .map(
            (item, index) =>
              `${index + 1}. ${item.title}\nURL: ${item.url}\n摘要: ${item.snippet || '（无摘要）'}`,
          )
          .join('\n\n'),
        { query: p.query, provider: searchProvider.id, results },
      )
    },
    replay: 'safe',
  }

  return [webSearch, webFetch]
}
