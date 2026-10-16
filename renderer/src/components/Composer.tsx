// components/Composer.tsx — 底部输入区：附件 / @提及 / 发送 / 停止
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChatSummary } from '@shared/types'
import { useMessagesStore } from '../stores/messagesStore'
import { useDraftsStore } from '../stores/draftsStore'
import { Avatar } from './Avatar'
import { AtIcon, SendIcon, StopIcon, PlusIcon, CloseIcon, QuoteIcon } from './icons'
import { ChatImage, attachmentUrl } from './ChatImage'
import { api } from '../lib/api'
import { MarkdownContent } from './MarkdownContent'

interface MemberLite {
  id: string
  name: string
  avatar: string
}

interface Props {
  chat: ChatSummary
}

const NO_AGENT_ACTIVITY: Record<string, 'preparing' | 'speaking'> = {}

export function Composer({ chat }: Props) {
  const send = useMessagesStore((s) => s.send)
  const stop = useMessagesStore((s) => s.stop)
  const generating = useMessagesStore((s) => !!s.generating[chat.id])
  const agentActivity =
    useMessagesStore((s) => s.agentActivity[chat.id]) ?? NO_AGENT_ACTIVITY

  const draft = useDraftsStore((s) => s.drafts[chat.id])
  const text = draft?.text ?? ''
  const quote = draft?.quote
  const attachments = draft?.attachments ?? []
  const [importing, setImporting] = useState(false)
  const importLock = useRef(false)
  const [imageError, setImageError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => setImageError(''), [chat.id])
  const addImages = async (files: File[]) => {
    if (importLock.current || !files.length) return
    const targetChatId = chat.id
    importLock.current = true
    setImporting(true)
    setImageError('')
    try {
      const previous =
        useDraftsStore.getState().drafts[targetChatId]?.attachments ?? []
      if (previous.length + files.length > 8)
        throw new Error('每条消息最多 8 张图片')
      if (files.some((f) => f.size > 16 * 1024 * 1024))
        throw new Error('每张图片最多 16MB')
      for (const file of files) {
        const image = await api.importChatImage(
          file.name,
          new Uint8Array(await file.arrayBuffer()),
        )
        const current =
          useDraftsStore.getState().drafts[targetChatId]?.attachments ?? []
        useDraftsStore
          .getState()
          .setDraft(targetChatId, { attachments: [...current, image] })
      }
    } catch (e) {
      setImageError(
        (e instanceof Error ? e.message : String(e)).replace(
          /^Error invoking remote method '[^']+': (?:Error: )?/,
          '',
        ),
      )
    } finally {
      importLock.current = false
      setImporting(false)
    }
  }
  const setDraft = useDraftsStore((s) => s.setDraft)
  const clearDraft = useDraftsStore((s) => s.clearDraft)
  const setText = (value: string) => setDraft(chat.id, { text: value })
  /** 输入期间记录的 @提及（botId -> 名字），发送时按文本实际内容提取 */
  const mentionNames = draft?.mentionNames ?? {}
  /** @ 浮层：打开时的触发位置（@ 字符下标）与过滤词 */
  const [mentionPopup, setMentionPopup] = useState<{
    anchor: number
    filter: string
  } | null>(null)
  const [popupIndex, setPopupIndex] = useState(0)
  const taRef = useRef<HTMLTextAreaElement>(null)

  const isGroup = chat.type === 'group'
  const members: MemberLite[] = useMemo(
    () => (isGroup ? chat.member_bots : []),
    [isGroup, chat.member_bots],
  )
  const allowDuringGeneration = isGroup
  const activeMembers = members.filter((member) => agentActivity[member.id])

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
    setDraft(chat.id, { mentionNames: { ...mentionNames, [m.id]: m.name } })
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
    const reply = text.trim()
    const quoted = quote ? `${quote.author}\n${quote.content}`.split('\n').map((line) => `> ${line}`).join('\n') : ''
    const content = [quoted, reply].filter(Boolean).join('\n\n')
    if (
      (!content && !attachments.length) ||
      (generating && !allowDuringGeneration) ||
      importLock.current
    )
      return
    // 提取仍然存在于文本中的 @提及
    const mentions = Object.entries(mentionNames)
      .filter(([, name]) => content.includes(`@${name}`))
      .map(([botId]) => botId)
    clearDraft(chat.id)
    closePopup()
    void send(
      chat.id,
      content,
      mentions,
      attachments,
      allowDuringGeneration,
    )
    taRef.current?.focus()
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || e.keyCode === 229) return
    if (mentionPopup && filteredMembers.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setPopupIndex((i) => (i + 1) % filteredMembers.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setPopupIndex(
          (i) => (i - 1 + filteredMembers.length) % filteredMembers.length,
        )
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
    <div
      className="composer-shell"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault()
          void addImages(Array.from(e.dataTransfer.files))
        }
      }}
      onPaste={(e) => {
        const files = Array.from(e.clipboardData.files)
        if (files.length) {
          e.preventDefault()
          void addImages(files)
        }
      }}
    >
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="sr-only"
        tabIndex={-1}
        aria-label="选择图片"
        onChange={(e) => {
          void addImages(Array.from(e.target.files ?? []))
          e.target.value = ''
        }}
      />
      {!!attachments.length && (
        <div className="composer-images">
          {attachments.map((item, i) => (
            <div className="composer-image" key={`${item.path}-${i}`}>
              <ChatImage src={attachmentUrl(item.path)} alt={item.name} />
              <button
                type="button"
                className="remove-image"
                aria-label={`移除图片：${item.name}`}
                onClick={() =>
                  setDraft(chat.id, {
                    attachments: attachments.filter((_, index) => index !== i),
                  })
                }
              >
                <CloseIcon width={12} height={12} />
              </button>
            </div>
          ))}
          <span className="image-count">{attachments.length}/8</span>
        </div>
      )}
      {imageError && (
        <div role="alert" className="mb-2 text-xs text-red-500">
          {imageError}
        </div>
      )}
      {activeMembers.length > 0 && (
        <div className="agent-activity" role="status" aria-live="polite">
          <div className="agent-activity-avatars" aria-hidden="true">
            {activeMembers.map((member) => (
              <span
                key={member.id}
                className={`agent-activity-avatar ${agentActivity[member.id]}`}
                title={`${member.name}${
                  agentActivity[member.id] === 'speaking'
                    ? '正在回复'
                    : '正在思考'
                }`}
              >
                <Avatar name={member.name} avatar={member.avatar} size={24} />
              </span>
            ))}
          </div>
          <span className="truncate">
            {activeMembers.map((member) => member.name).join('、')}
            {activeMembers.some(
              (member) => agentActivity[member.id] === 'speaking',
            )
              ? '正在回复…'
              : '正在思考是否回复…'}
          </span>
        </div>
      )}
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
                <span className="truncate text-stone-700 dark:text-stone-200">
                  {m.name}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="composer-box">
        {quote && (
          <div className="composer-quote" aria-label="引用内容">
            <QuoteIcon size={16} className="shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{quote.author}</div>
              <div className="composer-quote-text selectable"><MarkdownContent content={quote.content} /></div>
            </div>
            <button className="message-action shrink-0" aria-label="取消引用" title="取消引用" onClick={() => setDraft(chat.id, { quote: null })}>
              <CloseIcon width={16} height={16} />
            </button>
          </div>
        )}
        <textarea
          ref={taRef}
          id="message-composer"
          aria-label="输入消息"
          rows={1}
          value={text}
          onChange={(e) => {
            setText(e.target.value)
            updateMentionPopup(
              e.target.value,
              e.target.selectionStart ?? e.target.value.length,
            )
          }}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            const ta = e.currentTarget
            updateMentionPopup(ta.value, ta.selectionStart ?? ta.value.length)
          }}
          placeholder={
            isGroup ? '一起讨论点什么？输入 @ 提及成员' : '有什么新想法？'
          }
          className="selectable max-h-40 flex-1 resize-none bg-transparent py-1.5 text-[14px] leading-relaxed text-stone-800 outline-none placeholder:text-stone-400 dark:text-stone-100"
        />
        <div className="composer-controls">
        <button
          type="button"
          className="rounded-lg p-1.5 text-stone-400 hover:bg-stone-100 disabled:opacity-30 dark:hover:bg-stone-700"
          aria-label="添加图片"
          title="添加图片 · 支持多选、粘贴与拖放（最多8张）"
          disabled={importing || attachments.length >= 8}
          onClick={() => fileRef.current?.click()}
        >
          <PlusIcon width={20} height={20} />
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
        {generating && (
          <button
            onClick={() => void stop(chat.id)}
            className={`flex items-center gap-1.5 rounded-full bg-stone-700 text-[13px] text-white transition hover:bg-stone-800 dark:bg-stone-200 dark:text-stone-800 dark:hover:bg-stone-300 ${
              allowDuringGeneration ? 'p-2' : 'px-3.5 py-1.5'
            }`}
            title="停止生成"
            aria-label="停止生成"
          >
            <StopIcon width={14} height={14} />
            {!allowDuringGeneration && '停止'}
          </button>
        )}
        {(!generating || allowDuringGeneration) && (
          <button
            onClick={doSend}
            disabled={(!text.trim() && !attachments.length && !quote) || importing}
            className="rounded-full bg-ink p-2 text-white transition enabled:hover:bg-stone-700 disabled:opacity-30 dark:bg-stone-100 dark:text-stone-900 dark:enabled:hover:bg-stone-300"
            title="发送（Enter）"
            aria-label="发送"
          >
            <SendIcon width={17} height={17} />
          </button>
        )}
      </div>
      </div>
      <div className="composer-footer">
        <span>
          {importing
            ? '正在导入图片…'
            : generating
              ? allowDuringGeneration
                ? '群聊回复中 · 可继续补充，思考中的成员会更新上下文'
                : '正在回复，你可以先写下一条消息'
              : text || attachments.length
                ? '草稿已在本地保存'
                : '支持 Markdown · 多图粘贴与拖放'}
        </span>
        <span>Enter 发送 · Shift + Enter 换行</span>
      </div>
    </div>
  )
}
