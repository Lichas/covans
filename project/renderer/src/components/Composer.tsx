// components/Composer.tsx — 底部输入区：附件 / @提及 / 发送 / 停止
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSummary } from '@shared/types'
import { useMessagesStore } from '../stores/messagesStore'
import { Avatar } from './Avatar'
import { AtIcon, AttachIcon, SendIcon, StopIcon } from './icons'

interface MemberLite {
  id: string
  name: string
  avatar: string
}

interface Props {
  chat: ChatSummary
}

export function Composer({ chat }: Props) {
  const send = useMessagesStore((s) => s.send)
  const stop = useMessagesStore((s) => s.stop)
  const generating = useMessagesStore((s) => !!s.generating[chat.id])

  const [text, setText] = useState('')
  /** 输入期间记录的 @提及（botId -> 名字），发送时按文本实际内容提取 */
  const [mentionNames, setMentionNames] = useState<Record<string, string>>({})
  /** @ 浮层：打开时的触发位置（@ 字符下标）与过滤词 */
  const [mentionPopup, setMentionPopup] = useState<{ anchor: number; filter: string } | null>(null)
  const [popupIndex, setPopupIndex] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const isGroup = chat.type === 'group'
  const members: MemberLite[] = useMemo(
    () => (isGroup ? chat.member_bots : []),
    [isGroup, chat.member_bots],
  )

  const filteredMembers = useMemo(() => {
    if (!mentionPopup) return []
    const f = mentionPopup.filter.toLowerCase()
    return members.filter((m) => !f || m.name.toLowerCase().includes(f))
  }, [members, mentionPopup])

  // 自动增高
  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`
  }, [text])

  const closePopup = useCallback(() => setMentionPopup(null), [])

  const updateMentionPopup = (value: string, caret: number) => {
    if (!isGroup) {
      closePopup()
      return
    }
    const before = value.slice(0, caret)
    const at = before.lastIndexOf('@')
    if (at >= 0 && (at === 0 || /[\s\n]/.test(before[at - 1]))) {
      const token = before.slice(at + 1)
      if (!/[\s\n]/.test(token)) {
        setMentionPopup({ anchor: at, filter: token })
        setPopupIndex(0)
        return
      }
    }
    closePopup()
  }

  const pickMember = (m: MemberLite) => {
    const ta = taRef.current
    const caret = ta?.selectionStart ?? text.length
    setMentionNames((prev) => ({ ...prev, [m.id]: m.name }))
    if (mentionPopup) {
      const next = `${text.slice(0, mentionPopup.anchor)}@${m.name} ${text.slice(caret)}`
      setText(next)
      closePopup()
      requestAnimationFrame(() => {
        const pos = mentionPopup.anchor + m.name.length + 2
        ta?.focus()
        ta?.setSelectionRange(pos, pos)
      })
    }
  }

  const doSend = () => {
    const content = text.trim()
    if (!content || generating) return
    // 提取仍然存在于文本中的 @提及
    const mentions = Object.entries(mentionNames)
      .filter(([, name]) => content.includes(`@${name}`))
      .map(([botId]) => botId)
    setText('')
    setMentionNames({})
    closePopup()
    void send(chat.id, content, mentions)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionPopup && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPopupIndex((i) => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPopupIndex((i) => (i - 1 + filteredMembers.length) % filteredMembers.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        pickMember(filteredMembers[popupIndex] ?? filteredMembers[0])
        return
      }
      if (e.key === 'Escape') {
        closePopup()
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      doSend()
    }
  }

  const insertAt = () => {
    const ta = taRef.current
    const caret = ta?.selectionStart ?? text.length
    const next = `${text.slice(0, caret)}@${text.slice(caret)}`
    setText(next)
    requestAnimationFrame(() => {
      ta?.focus()
      ta?.setSelectionRange(caret + 1, caret + 1)
      updateMentionPopup(next, caret + 1)
    })
  }

  return (
    <div className="relative border-t border-stone-200 bg-white/60 px-4 py-3 dark:border-stone-800 dark:bg-stone-900/40">
      {/* @ 成员浮层 */}
      {mentionPopup && filteredMembers.length > 0 && (
        <div className="absolute bottom-full left-4 z-30 mb-2 w-60 animate-fadeIn overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg dark:border-stone-700 dark:bg-stone-800">
          <div className="border-b border-stone-100 px-3 py-2 text-[11.5px] text-stone-400 dark:border-stone-700">
            选择要提及的成员
          </div>
          <div className="scroll-thin max-h-52 overflow-y-auto p-1">
            {filteredMembers.map((m, i) => (
              <button
                key={m.id}
                onMouseDown={(e) => {
                  e.preventDefault()
                  pickMember(m)
                }}
                className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] ${
                  i === popupIndex
                    ? 'bg-stone-100 dark:bg-stone-700'
                    : 'hover:bg-stone-50 dark:hover:bg-stone-700/60'
                }`}
              >
                <Avatar name={m.name} avatar={m.avatar} size={26} />
                <span className="truncate text-stone-700 dark:text-stone-200">{m.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end gap-2 rounded-2xl border border-stone-200 bg-white px-2.5 py-2 shadow-sm dark:border-stone-700 dark:bg-stone-800">
        {/* 附件按钮（预留：当前 IPC 未提供消息附件通道） */}
        <button
          className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-300"
          title="添加附件（即将支持）"
          aria-label="添加附件"
          onClick={() => undefined}
        >
          <AttachIcon width={18} height={18} />
        </button>
        {/* @ 提及按钮（群聊） */}
        {isGroup && (
          <button
            onClick={insertAt}
            className="rounded-lg p-1.5 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            title="提及成员"
            aria-label="提及成员"
          >
            <AtIcon width={18} height={18} />
          </button>
        )}
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            updateMentionPopup(e.target.value, e.target.selectionStart ?? e.target.value.length)
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            const ta = e.currentTarget
            updateMentionPopup(ta.value, ta.selectionStart ?? ta.value.length)
          }}
          placeholder={isGroup ? '发消息，输入 @ 提及成员' : '发消息…'}
          className="selectable max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100"
        />
        {generating ? (
          <button
            onClick={() => void stop(chat.id)}
            className="flex items-center gap-1.5 rounded-full bg-stone-700 px-3.5 py-1.5 text-[13px] text-white transition hover:bg-stone-800 dark:bg-stone-200 dark:text-stone-800 dark:hover:bg-stone-300"
            title="停止生成"
          >
            <StopIcon width={14} height={14} />
            停止
          </button>
        ) : (
          <button
            onClick={doSend}
            disabled={!text.trim()}
            className="rounded-full bg-ink p-2 text-white transition enabled:hover:bg-stone-700 disabled:opacity-30 dark:bg-stone-100 dark:text-stone-900 dark:enabled:hover:bg-stone-300"
            title="发送（Enter）"
            aria-label="发送"
          >
            <SendIcon width={17} height={17} />
          </button>
        )}
      </div>
      <div className="mt-1.5 text-center text-[10.5px] text-stone-400">Enter 发送 · Shift+Enter 换行</div>
    </div>
  )
}
