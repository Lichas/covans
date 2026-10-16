import { useEffect, useState, type ReactNode } from 'react'
import {
  BookOpen,
  Check,
  ChevronLeft,
  Download,
  FolderOpen,
  Loader2,
  Pencil,
  Plug,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
} from 'lucide-react'
import type {
  BotExtensions,
  ExtensionCatalog,
  InstalledSkill,
  McpServer,
  McpServerInput,
  McpTransport,
} from '@shared/types'
import { api } from '../lib/api'
import { useUiStore } from '../stores/uiStore'
import { Field, Toggle, btnGhostCls, btnPrimaryCls, inputCls } from './controls'
import { MarkdownContent } from './MarkdownContent'

const errorText = (error: unknown) =>
  String(error)
    .replace(/^(?:Error:\s*)?Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
const iconButton =
  'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-stone-500 transition hover:bg-stone-100 disabled:opacity-40 dark:hover:bg-stone-700'

function Action({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={iconButton}
    >
      {children}
    </button>
  )
}

function McpForm({
  server,
  onDone,
}: {
  server: McpServer | null
  onDone: () => void
}) {
  const [name, setName] = useState(server?.name ?? '')
  const [transport, setTransport] = useState<McpTransport>(
    server?.transport ?? 'stdio',
  )
  const [command, setCommand] = useState(server?.command ?? '')
  const [args, setArgs] = useState(JSON.stringify(server?.args ?? [], null, 2))
  const [cwd, setCwd] = useState(server?.cwd ?? '')
  const [url, setUrl] = useState(server?.url ?? '')
  const [env, setEnv] = useState('')
  const [headers, setHeaders] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      let parsedArgs: string[]
      let parsedEnv: Record<string, string> | undefined
      let parsedHeaders: Record<string, string> | undefined
      try {
        parsedArgs = JSON.parse(args)
        parsedEnv = env.trim() ? JSON.parse(env) : undefined
        parsedHeaders = headers.trim() ? JSON.parse(headers) : undefined
      } catch {
        throw new Error('参数、环境变量或请求头的 JSON 格式无效')
      }
      const input: McpServerInput = {
        id: server?.id,
        name,
        transport,
        command,
        args: parsedArgs,
        cwd,
        url,
        enabled: server?.enabled ?? true,
        env: parsedEnv,
        headers: parsedHeaders,
      }
      await api.saveMcpServer(input)
      onDone()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      aria-label="MCP 配置"
    >
      <div className="flex items-center gap-2">
        <Action title="返回扩展列表" onClick={onDone} disabled={busy}>
          <ChevronLeft size={17} />
        </Action>
        <h3 className="text-sm font-medium">
          {server ? '编辑 MCP' : '安装 MCP'}
        </h3>
      </div>
      <Field label="名称">
        <input
          autoFocus
          className={inputCls}
          value={name}
          required
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
      <Field label="连接方式">
        <select
          className={inputCls}
          value={transport}
          onChange={(e) => setTransport(e.target.value as McpTransport)}
        >
          <option value="stdio">本地命令 · stdio</option>
          <option value="http">Streamable HTTP</option>
          <option value="sse">SSE</option>
        </select>
      </Field>
      {transport === 'stdio' ? (
        <>
          <Field label="启动命令">
            <input
              className={`${inputCls} font-mono`}
              placeholder="npx"
              value={command}
              required
              onChange={(e) => setCommand(e.target.value)}
            />
          </Field>
          <Field label="参数（JSON 数组）">
            <textarea
              className={`${inputCls} min-h-20 resize-y font-mono`}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder={'["-y", "@example/mcp-server"]'}
            />
          </Field>
          <Field label="工作目录（可选）">
            <input
              className={inputCls}
              placeholder="默认使用当前 Bot 工作区"
              value={cwd}
              onChange={(e) => setCwd(e.target.value)}
            />
          </Field>
          <Field label="环境变量（JSON，留空保留）">
            <textarea
              className={`${inputCls} min-h-20 resize-y font-mono`}
              value={env}
              onChange={(e) => setEnv(e.target.value)}
              placeholder={
                server?.env_keys.length
                  ? `已保存：${server.env_keys.join(', ')}`
                  : '{"API_TOKEN": "..."}'
              }
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <p className="text-xs text-stone-500">本地命令以当前用户权限运行。</p>
        </>
      ) : (
        <>
          <Field label="服务 URL">
            <input
              className={inputCls}
              type="url"
              placeholder="https://example.com/mcp"
              value={url}
              required
              onChange={(e) => setUrl(e.target.value)}
            />
          </Field>
          <Field label="请求头（JSON，留空保留）">
            <textarea
              className={`${inputCls} min-h-24 resize-y font-mono`}
              value={headers}
              onChange={(e) => setHeaders(e.target.value)}
              placeholder={
                server?.header_keys.length
                  ? `已保存：${server.header_keys.join(', ')}`
                  : '{"Authorization": "Bearer ..."}'
              }
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        </>
      )}
      {error && (
        <p role="alert" className="break-words text-xs text-red-500">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={btnGhostCls}
          disabled={busy}
          onClick={onDone}
        >
          取消
        </button>
        <button
          type="submit"
          className={btnPrimaryCls}
          disabled={busy || !name.trim()}
        >
          {busy ? '保存中…' : server ? '保存' : '安装'}
        </button>
      </div>
    </form>
  )
}

function SkillInstall({ onDone }: { onDone: (message?: string) => void }) {
  const [source, setSource] = useState('')
  const [subdirectory, setSubdirectory] = useState('')
  const [mode, setMode] = useState<'local' | 'git'>('local')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <form
      className="space-y-4"
      aria-label="Skill 安装"
      onSubmit={(e) => {
        e.preventDefault()
        setBusy(true)
        setError('')
        void api
          .installSkills(source, subdirectory)
          .then((skills) => onDone(`已安装 ${skills.length} 个 Skills`))
          .catch((e) => setError(errorText(e)))
          .finally(() => setBusy(false))
      }}
    >
      <div className="flex items-center gap-2">
        <Action title="返回扩展列表" onClick={() => onDone()} disabled={busy}>
          <ChevronLeft size={17} />
        </Action>
        <h3 className="text-sm font-medium">安装 Skills</h3>
      </div>
      <Field label="安装来源">
        <select
          className={inputCls}
          value={mode}
          disabled={busy}
          onChange={(e) => {
            setMode(e.target.value as 'local' | 'git')
            setSource('')
            setSubdirectory('')
          }}
        >
          <option value="local">本地目录</option>
          <option value="git">Git 仓库 · HTTPS</option>
        </select>
      </Field>
      <Field label={mode === 'local' ? 'Skill 目录' : '仓库地址'}>
        <div className="flex gap-2">
          <input
            className={`${inputCls} min-w-0 flex-1`}
            value={source}
            disabled={busy}
            required
            placeholder={
              mode === 'local'
                ? '/path/to/skills'
                : 'https://github.com/owner/repo.git'
            }
            onChange={(e) => setSource(e.target.value)}
          />
          {mode === 'local' && (
            <Action
              title="选择 Skill 目录"
              disabled={busy}
              onClick={() => {
                void api
                  .pickSkillDirectory()
                  .then((dir) => {
                    if (dir) setSource(dir)
                  })
                  .catch((e) => setError(errorText(e)))
              }}
            >
              <FolderOpen size={17} />
            </Action>
          )}
        </div>
      </Field>
      {mode === 'git' && (
        <Field label="仓库子目录（可选）">
          <input
            className={inputCls}
            value={subdirectory}
            disabled={busy}
            placeholder="skills/my-skill"
            onChange={(e) => setSubdirectory(e.target.value)}
          />
        </Field>
      )}
      <p className="text-xs text-stone-500">
        导入包含 SKILL.md 的目录；同名技能更新后保留 Bot 装配。
      </p>
      {error && (
        <p role="alert" className="break-words text-xs text-red-500">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={btnGhostCls}
          disabled={busy}
          onClick={() => onDone()}
        >
          取消
        </button>
        <button className={btnPrimaryCls} disabled={busy || !source.trim()}>
          {busy ? (
            <>
              <Loader2 size={14} className="mr-1 inline animate-spin" />
              安装中…
            </>
          ) : (
            '安装'
          )}
        </button>
      </div>
    </form>
  )
}

export function ExtensionsPanel({
  botId,
  section,
}: {
  botId?: string
  section?: 'mcp' | 'skills'
}) {
  const [catalog, setCatalog] = useState<ExtensionCatalog>({
    servers: [],
    skills: [],
  })
  const [config, setConfig] = useState<BotExtensions>({
    mcpServerIds: [],
    skillIds: [],
  })
  const [tab, setTab] = useState<'mcp' | 'skills'>(section ?? 'mcp')
  const [form, setForm] = useState<'mcp' | 'skill' | null>(null)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [preview, setPreview] = useState<{
    skill: InstalledSkill
    content: string
    files: string[]
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [revision, setRevision] = useState(0)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const setSettingsSection = useUiStore((s) => s.setSettingsSection)
  const activeTab = section ?? tab
  useEffect(() => {
    let alive = true
    let sequence = 0
    const load = async () => {
      const request = ++sequence
      try {
        const [next, bindings] = await Promise.all([
          api.listExtensions(),
          botId ? api.getBotExtensions(botId) : Promise.resolve(null),
        ])
        if (!alive || request !== sequence) return
        setCatalog(next)
        if (bindings) setConfig(bindings)
      } catch (e) {
        if (alive) setError(errorText(e))
      } finally {
        if (alive) setLoading(false)
      }
    }
    void load()
    const off = api.onEvent((event) => {
      if (
        event.type === 'extensions-updated' &&
        (!event.botId || !botId || event.botId === botId)
      )
        void load()
    })
    return () => {
      alive = false
      off()
    }
  }, [botId, revision])
  const perform = async (id: string, action: () => Promise<unknown>) => {
    setBusy(id)
    setError('')
    setNotice('')
    try {
      await action()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy('')
    }
  }
  const assign = (kind: keyof BotExtensions, id: string, enabled: boolean) =>
    perform(id, async () => {
      const next = {
        ...config,
        [kind]: enabled
          ? [...config[kind], id]
          : config[kind].filter((value) => value !== id),
      }
      setConfig(await api.setBotExtensions(botId!, next))
    })
  const closeForm = (message?: string) => {
    setForm(null)
    setEditing(null)
    setError('')
    setNotice(message ?? '')
  }
  const openManager = () => {
    setSettingsSection(activeTab)
    setSettingsOpen(true)
  }
  return (
    <div
      className={`extensions-panel min-w-0 space-y-4 ${botId ? 'p-4' : 'p-5'}`}
      data-testid={botId ? 'bot-extensions' : 'global-extensions'}
    >
      {form === 'mcp' ? (
        <McpForm server={editing} onDone={() => closeForm()} />
      ) : form === 'skill' ? (
        <SkillInstall onDone={closeForm} />
      ) : preview ? (
        <>
          <div className="flex items-center gap-2">
            <Action title="返回扩展列表" onClick={() => setPreview(null)}>
              <ChevronLeft size={17} />
            </Action>
            <h3 className="min-w-0 break-words text-sm font-medium">
              {preview.skill.name}
            </h3>
          </div>
          <div className="min-w-0 break-words text-sm">
            <MarkdownContent content={preview.content} />
          </div>
          <details className="border-t border-stone-200 pt-3 text-xs dark:border-stone-700">
            <summary className="cursor-pointer text-stone-500">
              文件 · {preview.files.length}
            </summary>
            <ul className="mt-2 space-y-1 break-all font-mono">
              {preview.files.map((file) => (
                <li key={file}>{file}</li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2">
            {!section ? (
              <div
                className="flex min-w-0 gap-1 rounded-md bg-stone-100 p-1 dark:bg-stone-900"
                role="tablist"
                aria-label="扩展类型"
              >
                {(['mcp', 'skills'] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={activeTab === value}
                    onClick={() => {
                      setTab(value)
                      setError('')
                      setNotice('')
                    }}
                    className={`rounded px-3 py-1.5 text-xs ${activeTab === value ? 'bg-white font-medium text-stone-800 shadow-sm dark:bg-stone-700 dark:text-stone-100' : 'text-stone-500'}`}
                  >
                    {value === 'mcp' ? 'MCP' : 'Skills'}{' '}
                    <span className="ml-1 text-stone-400">
                      {value === 'mcp'
                        ? catalog.servers.length
                        : catalog.skills.length}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-xs font-medium text-stone-600 dark:text-stone-300">
                {activeTab === 'mcp' ? '已安装 MCP 服务' : '已安装 Skills'}
              </div>
            )}
            {botId ? (
              <Action title="管理已安装扩展" onClick={openManager}>
                <Settings2 size={16} />
              </Action>
            ) : (
              <button
                className={`${btnGhostCls} inline-flex shrink-0 items-center gap-1.5`}
                onClick={() => {
                  setError('')
                  setForm(activeTab === 'mcp' ? 'mcp' : 'skill')
                  setEditing(null)
                }}
              >
                <Plus size={14} />
                安装
              </button>
            )}
          </div>
          {botId && (
            <p className="text-xs text-stone-500">
              已装配 {config.mcpServerIds.length} 个 MCP ·{' '}
              {config.skillIds.length} 个 Skills
            </p>
          )}
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2
                size={20}
                className="animate-spin text-stone-400"
                aria-label="加载扩展"
              />
            </div>
          ) : (
            <div className="divide-y divide-stone-200 dark:divide-stone-700">
              {activeTab === 'mcp'
                ? catalog.servers.map((server) => {
                    const selected = config.mcpServerIds.includes(server.id)
                    return (
                      <div
                        key={server.id}
                        className="py-3"
                        data-testid="mcp-row"
                      >
                        <div className="flex items-start gap-2.5">
                          <Plug
                            size={18}
                            className="mt-1 shrink-0 text-emerald-600 dark:text-emerald-400"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="break-words text-[13px] font-medium">
                              {server.name}
                            </div>
                            <div className="mt-1 break-words text-[11px] text-stone-500">
                              {server.transport === 'stdio'
                                ? '本地 stdio'
                                : server.transport === 'http'
                                  ? 'Streamable HTTP'
                                  : 'SSE'}{' '}
                              ·{' '}
                              {!server.enabled
                                ? '已停用'
                                : server.last_error
                                  ? '测试失败'
                                  : server.last_checked_at
                                    ? `测试通过 · ${server.tools.length} 个工具`
                                    : '未测试'}
                            </div>
                          </div>
                          <Toggle
                            label={
                              botId
                                ? `装配 ${server.name}`
                                : `启用 ${server.name}`
                            }
                            checked={botId ? selected : server.enabled}
                            disabled={
                              !!busy ||
                              (!!botId && !server.enabled && !selected)
                            }
                            onChange={(enabled) =>
                              void (botId
                                ? assign('mcpServerIds', server.id, enabled)
                                : perform(server.id, () =>
                                    api.saveMcpServer({ ...server, enabled }),
                                  ))
                            }
                          />
                        </div>
                        {!botId && (
                          <div className="mt-1 flex justify-end gap-1">
                            <Action
                              title={`测试 ${server.name}`}
                              disabled={!!busy}
                              onClick={() =>
                                void perform(server.id, async () => {
                                  const result = await api.testMcpServer(
                                    server.id,
                                  )
                                  if (!result.ok) throw new Error(result.error)
                                  setNotice(
                                    `连接成功 · ${result.tools.length} 个工具`,
                                  )
                                })
                              }
                            >
                              {busy === server.id ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <RefreshCw size={15} />
                              )}
                            </Action>
                            <Action
                              title={`编辑 ${server.name}`}
                              disabled={!!busy}
                              onClick={() => {
                                setEditing(server)
                                setForm('mcp')
                              }}
                            >
                              <Pencil size={15} />
                            </Action>
                            <Action
                              title={`卸载 ${server.name}`}
                              disabled={!!busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `卸载 MCP「${server.name}」？所有 Bot 的对应装配将被移除。`,
                                  )
                                )
                                  void perform(server.id, () =>
                                    api.deleteMcpServer(server.id),
                                  )
                              }}
                            >
                              <Trash2 size={15} />
                            </Action>
                          </div>
                        )}
                        {server.last_error && (
                          <p className="mt-2 break-words text-xs text-red-500">
                            {server.last_error}
                          </p>
                        )}
                        {server.tools.length > 0 && (
                          <details className="mt-2 pl-7 text-xs">
                            <summary className="cursor-pointer text-stone-500">
                              工具 · {server.tools.length}
                            </summary>
                            <ul className="mt-2 space-y-2">
                              {server.tools.map((tool) => (
                                <li key={tool.name}>
                                  <div className="break-all font-mono text-stone-700 dark:text-stone-200">
                                    {tool.name}
                                  </div>
                                  <p className="mt-0.5 break-words text-stone-500">
                                    {tool.description}
                                  </p>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </div>
                    )
                  })
                : catalog.skills.map((skill) => {
                    const selected = config.skillIds.includes(skill.id)
                    return (
                      <div
                        key={skill.id}
                        className="py-3"
                        data-testid="skill-row"
                      >
                        <div className="flex items-start gap-2.5">
                          <BookOpen
                            size={18}
                            className="mt-1 shrink-0 text-sky-600 dark:text-sky-400"
                          />
                          <div className="min-w-0 flex-1">
                            <div className="break-words text-[13px] font-medium">
                              {skill.name}
                            </div>
                            <p className="mt-1 break-words text-xs leading-relaxed text-stone-500">
                              {skill.description}
                            </p>
                            <div className="mt-1 text-[11px] text-stone-400">
                              {skill.file_count} 个文件
                              {!skill.enabled ? ' · 已停用' : ''}
                            </div>
                          </div>
                          <Toggle
                            label={
                              botId
                                ? `装配 ${skill.name}`
                                : `启用 ${skill.name}`
                            }
                            checked={botId ? selected : skill.enabled}
                            disabled={
                              !!busy || (!!botId && !skill.enabled && !selected)
                            }
                            onChange={(enabled) =>
                              void (botId
                                ? assign('skillIds', skill.id, enabled)
                                : perform(skill.id, () =>
                                    api.setSkillEnabled(skill.id, enabled),
                                  ))
                            }
                          />
                        </div>
                        <div className="mt-1 flex justify-end gap-1">
                          <Action
                            title={`查看 ${skill.name}`}
                            disabled={!!busy}
                            onClick={() =>
                              void perform(skill.id, async () =>
                                setPreview({
                                  skill,
                                  ...(await api.readInstalledSkill(skill.id)),
                                }),
                              )
                            }
                          >
                            <BookOpen size={15} />
                          </Action>
                          {!botId && (
                            <Action
                              title={`卸载 ${skill.name}`}
                              disabled={!!busy}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    `卸载 Skill「${skill.name}」？所有 Bot 的对应装配将被移除。`,
                                  )
                                )
                                  void perform(skill.id, () =>
                                    api.deleteSkill(skill.id),
                                  )
                              }}
                            >
                              <Trash2 size={15} />
                            </Action>
                          )}
                        </div>
                      </div>
                    )
                  })}
              {(tab === 'mcp'
                ? !catalog.servers.length
                : !catalog.skills.length) && (
                <div className="flex flex-col items-center gap-3 py-10 text-stone-400">
                  <Download size={24} strokeWidth={1.5} />
                  <p className="text-xs">
                    尚未安装 {tab === 'mcp' ? 'MCP 服务' : 'Skills'}
                  </p>
                  {botId && (
                    <button className={btnGhostCls} onClick={openManager}>
                      安装扩展
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </>
      )}
      {error && (
        <div className="flex items-start gap-1">
          <p
            role="alert"
            className="min-w-0 flex-1 break-words text-xs text-red-500"
          >
            {error}
          </p>
          <Action
            title="刷新扩展"
            onClick={() => {
              setError('')
              setRevision((n) => n + 1)
            }}
          >
            <RefreshCw size={14} />
          </Action>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
        >
          <Check size={14} />
          {notice}
        </p>
      )}
    </div>
  )
}
