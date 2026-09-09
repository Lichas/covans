import { useEffect, useMemo, useState } from 'react'
import { useBotsStore } from '../stores/botsStore'
import { useChatsStore } from '../stores/chatsStore'
import { useUiStore } from '../stores/uiStore'
import { Avatar } from './Avatar'
import { Dialog } from './Dialog'
import { Field, btnGhostCls, btnPrimaryCls, inputCls } from './controls'

/** 在群聊中加成员；单聊则保留原单聊并以它为基础创建一个群聊。 */
export function InviteBotsDialog() {
  const chatId = useUiStore((s) => s.inviteChatId)
  const close = () => useUiStore.getState().setInviteChatId(null)
  const chats = useChatsStore((s) => s.chats)
  const bots = useBotsStore((s) => s.bots)
  const addChatMembers = useChatsStore((s) => s.addChatMembers)
  const createGroup = useChatsStore((s) => s.createGroup)
  const chat = chats.find((item) => item.id === chatId) ?? null
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const existingIds = useMemo(
    () => new Set(chat?.member_bots.map((bot) => bot.id) ?? []),
    [chat],
  )
  const candidates = bots.filter((bot) => !existingIds.has(bot.id))
  const isGroup = chat?.type === 'group'

  useEffect(() => {
    if (!chat) return
    setSelected(new Set())
    setName(isGroup ? '' : `${chat.member_bots[0]?.name ?? 'Bot'} 和伙伴们`)
    setError('')
  }, [chat?.id, isGroup])

  const submit = async () => {
    if (!chat || !selected.size || busy) return
    setBusy(true)
    setError('')
    try {
      if (isGroup) await addChatMembers(chat.id, [...selected])
      else
        await createGroup(
          name.trim() || `${chat.member_bots[0]?.name ?? 'Bot'} 和伙伴们`,
          [...existingIds, ...selected],
        )
      close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={!!chat}
      title={isGroup ? '邀请 Bot 加入群聊' : '邀请 Bot 组队'}
      onClose={close}
    >
      <div className="space-y-4 p-5">
        <p className="text-[12.5px] leading-relaxed text-stone-500 dark:text-stone-400">
          {isGroup
            ? '邀请的 Bot 会加入当前群聊，并从下一次消息开始拥有共享上下文。'
            : '原单聊会保留；邀请后将新建一个包含这些 Bot 的群聊。'}
        </p>
        {!isGroup && (
          <Field label="新群名称">
            <input
              autoFocus
              className={inputCls}
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="如：晚间闲聊小组"
            />
          </Field>
        )}
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-stone-500 dark:text-stone-400">
            选择要邀请的 Bot（{selected.size}）
          </div>
          <div className="scroll-thin max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-stone-200 p-1.5 dark:border-stone-700">
            {candidates.map((bot) => {
              const checked = selected.has(bot.id)
              return (
                <label
                  key={bot.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition ${checked ? 'bg-stone-100 dark:bg-stone-700/70' : 'hover:bg-stone-50 dark:hover:bg-stone-800'}`}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-stone-600"
                    checked={checked}
                    onChange={() =>
                      setSelected((previous) => {
                        const next = new Set(previous)
                        if (next.has(bot.id)) next.delete(bot.id)
                        else next.add(bot.id)
                        return next
                      })
                    }
                  />
                  <Avatar name={bot.name} avatar={bot.avatar} size={28} />
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] text-stone-700 dark:text-stone-200">
                      {bot.name}
                    </span>
                    <span className="block truncate text-[11px] text-stone-400">
                      {bot.description || '随时准备加入'}
                    </span>
                  </span>
                </label>
              )
            })}
            {!candidates.length && (
              <div className="py-7 text-center text-[12.5px] text-stone-400">
                {isGroup
                  ? '所有 Bot 已在这个群聊中'
                  : '还没有其他 Bot 可以邀请'}
              </div>
            )}
          </div>
        </div>
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-600 dark:bg-red-950/50 dark:text-red-300"
          >
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button className={btnGhostCls} onClick={close}>
            取消
          </button>
          <button
            className={btnPrimaryCls}
            disabled={!selected.size || busy}
            onClick={() => void submit()}
          >
            {busy ? '正在邀请…' : isGroup ? '发送邀请' : '创建群聊'}
          </button>
        </div>
      </div>
    </Dialog>
  )
}
