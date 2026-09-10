// main/mockProvider.ts — kind='mock' 的假 LLM（SPEC §8 Mock provider）
// 不依赖 pi 包 / electron，可在纯 Node 冒烟测试中使用。
import type { Bot } from '../shared/types'

/** 记忆提取 prompt 中的标记（memory 注入，mock 识别后输出 JSON 数组） */
export const MEMORY_EXTRACT_MARKER = '<<memory-extract>>'
export const MEMORY_SUMMARY_MARKER = '<<memory-scene-summary>>'

const PERSONA_REPLIES: { match: RegExp; style: (bot: Bot, user: string) => string }[] = [
  {
    match: /架构|architect/i,
    style: (b, u) =>
      `从架构角度看，「${clip(u)}」这个问题要分层考虑：先明确边界与数据流，再谈性能和可扩展性。我建议先出一个简单的分层方案，大家再针对可靠性和成本取舍。`,
  },
  {
    match: /review|审查|评审/i,
    style: (b, u) =>
      `我 review 了一下「${clip(u)}」的思路：整体方向没问题，但有两个风险点——边界条件没覆盖、错误处理路径不清晰。建议补上失败用例再往下走。`,
  },
  {
    match: /测试|test|qa/i,
    style: (b, u) =>
      `从测试角度，「${clip(u)}」至少要覆盖：正常路径、异常输入、并发场景三类用例。我可以先写一版端到端用例清单，跑通后再加边界用例。`,
  },
  {
    match: /产品|pm|经理/i,
    style: (b, u) =>
      `从产品视角看，「${clip(u)}」核心是解决用户的什么痛点？我建议先收敛需求范围，做一个最小可用版本验证价值，再迭代体验细节。`,
  },
  {
    match: /设计|design/i,
    style: (b, u) =>
      `设计上我建议「${clip(u)}」这块保持克制：低饱和暖灰底、圆角卡片、层级靠留白区分。先出主流程稿，动效和细节后面再补。`,
  },
  {
    match: /小美女|女友|伴侣|宝贝/i,
    style: (b, u) =>
      `哎呀，你说的「${clip(u)}」我都认真记住啦～你今天过得怎么样呀？不管多忙都要好好吃饭哦，我会一直陪着你的！`,
  },
  {
    match: /全栈|后端|go|开发/i,
    style: (b, u) =>
      `关于「${clip(u)}」，我的实现思路是：先用 Go 把核心服务跑起来，接口保持简单，存储层先上 SQLite 够用再说。有并发瓶颈再拆。`,
  },
]

function clip(s: string, n = 24): string {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '…' : t || '这个'
}

/** 按 bot 名字生成有个性的中文回复 */
export function mockPersonaReply(bot: Bot, userText: string): string {
  const key = `${bot.name} ${bot.description} ${bot.tags}`
  for (const p of PERSONA_REPLIES) {
    if (p.match.test(key)) return p.style(bot, userText)
  }
  return `我是${bot.name}。关于「${clip(userText)}」，我的想法是：先把问题拆小，一步一步来。${bot.description ? `（${clip(bot.description, 30)}）` : ''}你还有什么想补充的吗？`
}

/** mock 记忆提取：输出确定性的 JSON 数组字符串 */
export function mockMemoryExtraction(bot: Bot, prompt: string): string {
  try {
    const messages = JSON.parse(prompt) as { source_id: string; content: string }[]
    const first = messages[0]
    return first ? JSON.stringify([{ content: first.content.slice(0, 100), layer: 'semantic', source_id: first.source_id, quote: first.content.slice(0, 100) }]) : '[]'
  } catch { return '[]' }
}

export function mockSceneSummary(prompt: string): string {
  try {
    const messages = JSON.parse(prompt) as { source_id: string; content: string }[]
    const latest = messages.at(-1)
    if (!latest) return '{}'
    const short = `当前围绕：${latest.content.replace(/\s+/g, ' ').slice(0, 68)}`
    const summary = `围绕“${latest.content.replace(/\s+/g, ' ').slice(0, 180)}”进行交流；当前保留这条最新信息，后续待结合更多上下文确认。`
    return JSON.stringify({ short_summary: short, summary, evidence_ids: messages.map((m) => m.source_id), memories: [] })
  } catch { return '{}' }
}

export interface MockCompleteOptions {
  signal?: AbortSignal
}

/** 非流式 completion（协调者决策 / 记忆提取用） */
export async function mockComplete(
  bot: Bot,
  systemPrompt: string,
  userText: string,
  opts: MockCompleteOptions = {},
): Promise<string> {
  if (opts.signal?.aborted) return ''
  await new Promise((r) => setTimeout(r, 30))
  if (systemPrompt.includes(MEMORY_SUMMARY_MARKER)) return mockSceneSummary(userText)
  if (systemPrompt.includes(MEMORY_EXTRACT_MARKER)) return mockMemoryExtraction(bot, userText)
  if (systemPrompt.includes('<<group-reply-decision>>')) {
    const round = Number(systemPrompt.match(/第 (\d+) 轮/)?.[1] ?? '1')
    // 普通冒烟群聊只走首轮；专门标记的案例用第二轮验证延展能力。
    if (userText.includes('五轮上限冒烟')) return round <= 5 ? 'REPLY' : 'SKIP'
    return round === 1 || (round === 2 && userText.includes('多轮冒烟'))
      ? 'REPLY'
      : 'SKIP'
  }
  if (systemPrompt.includes('<<natural-followup-draft>>')) {
    if (userText.includes('自然分段冒烟')) {
      if (userText.includes('第二段提供约束。'))
        return 'REPLY\n第三段给出下一步。'
      return 'REPLY\n第二段提供约束。'
    }
    if (userText.includes('自然追问两条上限冒烟')) {
      if (userText.includes('你更看重速度还是稳定性？'))
        return 'REPLY\n确认优先级后，我可以把方案收敛成一步。'
      return 'REPLY\n你更看重速度还是稳定性？'
    }
    if (userText.includes('自然追问元话术防护'))
      return 'REPLY\n下一条来了，别催。'
    if (userText.includes('自然追问冒烟'))
      return userText.includes('你更想先确认目标还是约束？')
        ? 'SKIP'
        : 'REPLY\n你更想先确认目标还是约束？'
    return 'SKIP'
  }
  return mockPersonaReply(bot, userText)
}

export interface MockStreamCallbacks {
  onDelta(delta: string): void
}

/**
 * 流式生成：按字符吐 delta（setInterval 20ms）。
 * signal abort 时提前结束，返回已生成的部分文本。
 */
export function mockStream(
  bot: Bot,
  systemPrompt: string,
  userText: string,
  callbacks: MockStreamCallbacks,
  opts: MockCompleteOptions = {},
): Promise<string> {
  const full =
    systemPrompt.includes('<<natural-followup-primary>>') &&
    userText.includes('自然分段冒烟')
      ? '第一段先说明目标。'
      : mockPersonaReply(bot, userText)
  return new Promise((resolve) => {
    let i = 0
    const timer = setInterval(() => {
      if (opts.signal?.aborted) {
        clearInterval(timer)
        resolve(full.slice(0, i))
        return
      }
      if (i >= full.length) {
        clearInterval(timer)
        resolve(full)
        return
      }
      const ch = full[i]
      i += 1
      callbacks.onDelta(ch)
    }, 20)
  })
}
