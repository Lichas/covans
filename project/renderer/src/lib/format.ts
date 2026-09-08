// lib/format.ts — 时间与头像相关的展示辅助
import type { Bot } from '@shared/types'

/** 会话列表时间：今天 HH:mm，昨天，一周内周几，更早 MM-DD / YYYY-MM-DD */
export function formatChatTime(ts: number): string {
  if (!ts) return ''
  const d = new Date(ts)
  const now = new Date()
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const dayDiff = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000)
  const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  if (dayDiff <= 0) return hhmm
  if (dayDiff === 1) return '昨天'
  if (dayDiff < 7) return ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()]
  const md = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  if (d.getFullYear() === now.getFullYear()) return md
  return `${d.getFullYear()}-${md}`
}

export function formatFullTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** bot 名字首字占位头像的固定配色（按名字哈希取色，低饱和暖色） */
const AVATAR_COLORS = [
  'bg-amber-200 text-amber-800',
  'bg-orange-200 text-orange-800',
  'bg-rose-200 text-rose-800',
  'bg-emerald-200 text-emerald-800',
  'bg-teal-200 text-teal-800',
  'bg-sky-200 text-sky-800',
  'bg-indigo-200 text-indigo-800',
  'bg-stone-300 text-stone-700',
]

export function avatarColor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length]
}

export function botInitial(name: string): string {
  return (name || '?').trim().charAt(0).toUpperCase() || '?'
}

/**
 * bot.avatar 是「相对 userData 的路径」或「emoji:xx 内置头像 id」。
 * 渲染层无法直接拼 userData 绝对路径，约定通过主进程注册的
 * covan-avatar://<path> 协议加载；emoji: 前缀直接展示字符。
 */
export function avatarSrc(avatar: string): { kind: 'emoji'; char: string } | { kind: 'url'; url: string } | { kind: 'none' } {
  if (!avatar) return { kind: 'none' }
  if (avatar.startsWith('emoji:')) return { kind: 'emoji', char: avatar.slice('emoji:'.length) }
  return { kind: 'url', url: `covan-avatar://${encodeURIComponent(avatar)}` }
}

/** 群组叠头像用的成员（最多前几个） */
export function groupMembersOf(botMap: Map<string, Bot>, memberIds: string[]): Bot[] {
  return memberIds.map((id) => botMap.get(id)).filter((b): b is Bot => !!b)
}
