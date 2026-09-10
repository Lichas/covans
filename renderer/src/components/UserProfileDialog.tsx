import { useEffect, useState } from 'react'
import type {
  MemoryKind,
  UserMemory,
  UserPresetAvatar,
  UserProfile,
} from '@shared/types'
import { api } from '../lib/api'
import { useUiStore } from '../stores/uiStore'
import { useBotsStore } from '../stores/botsStore'
import { formatFullTime } from '../lib/format'
import { Dialog } from './Dialog'
import { Field, Toggle, inputCls, btnPrimaryCls, btnGhostCls } from './controls'
import { MeIcon, PencilIcon, PlusIcon, TrashIcon } from './icons'
import { Avatar } from './Avatar'

const empty: UserProfile = {
  avatar: '',
  name: '',
  role: '',
  bio: '',
  preferences: '',
  goals: '',
  boundaries: '',
  accept_mature_content: false,
}
export function UserProfileDialog() {
  const open = useUiStore((s) => s.profileOpen)
  const setOpen = useUiStore((s) => s.setProfileOpen)
  const bots = useBotsStore((s) => s.bots)
  const [tab, setTab] = useState<'profile' | 'memory'>('profile')
  const [profile, setProfile] = useState<UserProfile>(empty)
  const [presetAvatars, setPresetAvatars] = useState<UserPresetAvatar[]>([])
  const [memories, setMemories] = useState<UserMemory[]>([])
  const [content, setContent] = useState('')
  const [kind, setKind] = useState<MemoryKind>('fact')
  const [editing, setEditing] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [status, setStatus] = useState('')
  useEffect(() => {
    if (!open) return
    setTab('profile')
    let active = true
    setStatus('')
    setLoaded(false)
    Promise.all([
      api.getUserProfile(),
      api.listUserMemories(),
      api.listUserPresetAvatars(),
    ])
      .then(([p, m, presets]) => {
        if (active) {
          setProfile(p)
          setMemories(m)
          setPresetAvatars(presets)
          setLoaded(true)
        }
      })
      .catch((e) => {
        if (active) setStatus(String(e))
      })
    const off = api.onEvent((ev) => {
      if (ev.type === 'user-context-updated')
        void api
          .listUserMemories()
          .then((m) => {
            if (active) setMemories(m)
          })
          .catch((e) => setStatus(String(e)))
    })
    return () => {
      active = false
      off()
    }
  }, [open])
  const action = async (work: () => Promise<unknown>, message: string) => {
    setBusy(true)
    setStatus('')
    try {
      await work()
      setStatus(message)
      setMemories(await api.listUserMemories())
    } catch (e) {
      setStatus(String(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open={open}
      title="关于我"
      width="w-[720px]"
      onClose={() => setOpen(false)}
    >
      <div className="profile-intro">
        <span className="profile-symbol">
          <MeIcon width={24} height={24} />
        </span>
        <div>
          <h3>让每位 Bot，都更懂你。</h3>
          <p>你掌握自己的资料与记忆。这里的内容会作为所有 Bot 的共同背景。</p>
        </div>
      </div>
      <div className="profile-tabs">
        {[
          ['profile', '我的资料'],
          ['memory', `对我的了解 · ${memories.length}`],
        ].map(([key, label]) => (
          <button
            key={key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key as typeof tab)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-5 p-6">
        {tab === 'profile' ? (
          <>
            <section
              aria-label="内容偏好"
              className="rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-700 dark:bg-stone-900/30"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h4 className="text-[13px] font-medium">
                    接受成熟内容{' '}
                    <span className="ml-1 text-[10px] text-stone-400">18+</span>
                  </h4>
                  <p className="mt-1.5 max-w-[490px] text-[12px] leading-relaxed text-stone-500 dark:text-stone-400">
                    显示泳装等成熟风格生活照；成年伴侣可以有非露骨的暧昧、轻度调情与成人玩笑。随时可以关闭，仍以你当下的边界为准。
                  </p>
                </div>
                <Toggle
                  label="接受成熟内容"
                  checked={profile.accept_mature_content}
                  disabled={busy || !loaded}
                  onChange={(value) => {
                    void action(
                      async () => {
                        const saved = await api.getUserProfile()
                        await api.saveUserProfile({
                          ...saved,
                          accept_mature_content: value,
                        })
                        setProfile((draft) => ({
                          ...draft,
                          accept_mature_content: value,
                        }))
                      },
                      value ? '已开启成熟内容偏好' : '已关闭成熟内容偏好',
                    )
                  }}
                />
              </div>
              <p className="mt-2 text-[11px] text-stone-400">
                开关立即保存，影响生活照、新建伴侣模板及后续对话。
              </p>
            </section>
            <div className="flex items-center gap-4 rounded-xl border border-stone-200 bg-stone-50/70 p-4 dark:border-stone-700 dark:bg-stone-800/50">
              <Avatar
                name={profile.name || '我'}
                avatar={profile.avatar}
                size={64}
              />
              <div className="min-w-0 flex-1">
                <strong className="block text-[13px] text-stone-800 dark:text-stone-100">
                  我的头像
                </strong>
                <p className="mt-1 text-[11px] leading-relaxed text-stone-500 dark:text-stone-400">
                  保存在本机，用于侧边栏与“关于我”资料，不会发送给模型服务。
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {profile.avatar && (
                  <button
                    className={btnGhostCls}
                    disabled={busy}
                    onClick={() =>
                      void action(async () => {
                        const next = await api.saveUserProfile({
                          ...profile,
                          avatar: '',
                        })
                        setProfile(next)
                      }, '已恢复默认头像')
                    }
                  >
                    恢复默认
                  </button>
                )}
                <button
                  className={btnGhostCls}
                  disabled={busy || !loaded}
                  onClick={() =>
                    void action(async () => {
                      const next = await api.pickUserAvatar()
                      setProfile(next)
                    }, '头像已更新')
                  }
                >
                  上传自定义头像
                </button>
              </div>
            </div>
            {presetAvatars.length > 0 && (
              <section className="user-preset-avatars" aria-label="默认头像">
                <div>
                  <strong>选择默认头像</strong>
                  <p>也可以上传自己的图片；选择后立即保存。</p>
                </div>
                <div className="user-preset-avatar-grid" role="group">
                  {presetAvatars.map((preset) => (
                    <button
                      type="button"
                      key={preset.id}
                      disabled={busy || !loaded}
                      aria-label={`选择${preset.label}`}
                      aria-pressed={profile.avatar === preset.avatar}
                      onClick={() =>
                        void action(async () => {
                          const next = await api.saveUserProfile({
                            ...profile,
                            avatar: preset.avatar,
                          })
                          setProfile(next)
                        }, `${preset.label}已应用`)
                      }
                    >
                      <span className="preset-portrait">
                        <Avatar
                          name={preset.label}
                          avatar={preset.avatar}
                          size={42}
                        />
                        {profile.avatar === preset.avatar && (
                          <span className="preset-check" aria-hidden="true">
                            ✓
                          </span>
                        )}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            <div className="grid grid-cols-2 gap-4">
              <Field label="怎么称呼我">
                <input
                  className={inputCls}
                  value={profile.name}
                  placeholder="你希望 Bot 如何称呼你"
                  onChange={(e) =>
                    setProfile({ ...profile, name: e.target.value })
                  }
                />
              </Field>
              <Field label="我的角色">
                <input
                  className={inputCls}
                  value={profile.role}
                  placeholder="职业、身份或目前的重心"
                  onChange={(e) =>
                    setProfile({ ...profile, role: e.target.value })
                  }
                />
              </Field>
            </div>
            {(
              [
                ['bio', '关于我的介绍', '你的背景、兴趣，以及希望它们了解的事'],
                [
                  'preferences',
                  '交流与生活偏好',
                  '例如：中文交流、简洁直接，喜欢先看结论',
                ],
                [
                  'goals',
                  '我正在关注的目标',
                  '正在做的项目、想学的技能、近期计划',
                ],
                [
                  'boundaries',
                  '我希望遵守的边界',
                  '不喜欢的称呼、不想讨论的话题或其他约定',
                ],
              ] as const
            ).map(([key, label, placeholder]) => (
              <Field key={key} label={label}>
                <textarea
                  rows={2}
                  maxLength={5000}
                  className={inputCls}
                  value={profile[key]}
                  placeholder={placeholder}
                  onChange={(e) =>
                    setProfile({ ...profile, [key]: e.target.value })
                  }
                />
              </Field>
            ))}
            <div className="flex items-center justify-between gap-4">
              <span className="text-[11px] text-stone-400">
                保存在本机，对话时会发送给对应模型服务。请勿填写密钥或不希望共享的敏感信息。
              </span>
              <button
                className={btnPrimaryCls + ' shrink-0'}
                disabled={busy || !loaded}
                onClick={() =>
                  void action(() => api.saveUserProfile(profile), '资料已保存')
                }
              >
                {busy ? '保存中…' : '保存资料'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-xl border border-stone-200 p-4 dark:border-stone-700">
              <Field label={editing ? '编辑这条记忆' : '补充一件关于我的事'}>
                <textarea
                  rows={2}
                  className={inputCls}
                  maxLength={1000}
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="例如：我喜欢直接给出可运行的代码"
                />
              </Field>
              <div className="mt-3 flex justify-between gap-3">
                <select
                  className={inputCls + ' max-w-[120px]'}
                  aria-label="记忆类型"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as MemoryKind)}
                >
                  <option value="fact">个人事实</option>
                  <option value="preference">偏好</option>
                  <option value="summary">目标与约定</option>
                </select>
                <div className="flex gap-2">
                  {editing && (
                    <button
                      className={btnGhostCls}
                      onClick={() => {
                        setEditing(undefined)
                        setContent('')
                      }}
                    >
                      取消编辑
                    </button>
                  )}
                  <button
                    className={btnPrimaryCls}
                    disabled={busy || !content.trim()}
                    onClick={() =>
                      void action(async () => {
                        await api.saveUserMemory(content, kind, editing)
                        setContent('')
                        setEditing(undefined)
                      }, '记忆已保存')
                    }
                  >
                    <PlusIcon width={13} height={13} className="mr-1 inline" />
                    {editing ? '保存修改' : '添加记忆'}
                  </button>
                </div>
              </div>
            </div>
            {!memories.length && (
              <p className="py-6 text-center text-[12px] text-stone-400">
                还没有共同记忆。也可以在聊天中说「请记住，我……」。
              </p>
            )}
            {memories.map((m) => (
              <div className="user-memory-row" key={m.id}>
                <div className="min-w-0 flex-1">
                  <p className="selectable whitespace-pre-wrap text-[13px] leading-relaxed">
                    {m.content}
                  </p>
                  <div className="mt-2 text-[10px] text-stone-400">
                    {m.source === 'manual'
                      ? '我填写的'
                      : `${bots.find((b) => b.id === m.source_bot_id)?.name || 'Bot'} 记住的`}{' '}
                    · {formatFullTime(m.created_at)}
                  </div>
                </div>
                <button
                  className="icon-button"
                  aria-label="编辑记忆"
                  onClick={() => {
                    setEditing(m.id)
                    setContent(m.content)
                    setKind(m.kind)
                  }}
                >
                  <PencilIcon width={14} height={14} />
                </button>
                <button
                  className="icon-button"
                  aria-label="删除记忆"
                  disabled={busy}
                  onClick={() =>
                    void action(() => api.deleteUserMemory(m.id), '记忆已删除')
                  }
                >
                  <TrashIcon width={14} height={14} />
                </button>
              </div>
            ))}
          </>
        )}
        {status && (
          <div
            role="status"
            className="text-[12px] text-stone-500 dark:text-stone-300"
          >
            {status}
          </div>
        )}
      </div>
    </Dialog>
  )
}
