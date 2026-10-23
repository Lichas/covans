import type { Bot, ChatSummary, Message } from '@shared/types'
import { splitUiMessage } from '@shared/openui'
import { useDraftsStore } from '../stores/draftsStore'

/** A generated interface can only stage a reply in its original conversation. */
export function stageUiReply(chat: ChatSummary, message: Message, bot: Bot, text: string): void {
  if (message.chat_id !== chat.id || message.sender_type !== 'bot' || message.sender_bot_id !== bot.id || message.status !== 'done' || !chat.member_bots.some((member) => member.id === bot.id)) return
  const store = useDraftsStore.getState()
  const draft = store.drafts[chat.id]
  let previous = draft?.text ?? ''
  if (draft?.quote && draft.quote.messageId !== message.id) {
    previous = `> ${draft.quote.author}：\n${draft.quote.content.split('\n').map((line) => `> ${line}`).join('\n')}\n\n${previous}`
  }
  const excerpt = splitUiMessage(message.content).filter((part) => part.kind === 'markdown').map((part) => part.content.trim()).filter(Boolean).join('\n').slice(0, 300)
  store.setDraft(chat.id, {
    text: [previous.trim(), `${chat.type === 'group' ? `@${bot.name} ` : ''}${text}`].filter(Boolean).join('\n\n'),
    mentionNames: { ...(draft?.mentionNames ?? {}), ...(chat.type === 'group' ? { [bot.id]: bot.name } : {}) },
    quote: { messageId: message.id, author: bot.name, content: excerpt || `交互界面：${text.split('\n')[0]}` },
  })
}
