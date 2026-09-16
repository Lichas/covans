import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { Attachment, BotInput, MemoryKind, ScheduledTask } from '../shared/types'
import { storeChatImage, imageContent } from './chatImages'
import * as db from './db'
import {
  expandAvatarPrompt,
  generateBotAvatar,
  requestGeneratedImage,
  refreshAutomaticAvatar,
  type AvatarMode,
} from './avatars'
import { beginAgentConversation } from './privateConversations'
import { observeScheduledTaskChange, refreshScheduledTasks } from './scheduledTasks'

const result = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value) }],
  details: {},
})
const optionalId = Type.Optional(
  Type.String({
    description: '目标 Bot ID，省略表示当前 Bot；先用 list_bots 找到准确 ID',
  }),
)

export function createAppTools(
  botId: string,
  chatId: string,
  parentSignal?: AbortSignal,
  onImages?: (images: Attachment[]) => void,
): AgentTool[] {
  let privateCalls = 0
  let imageCalls = 0
  const taskSummary = (task: ScheduledTask) => ({
    id: task.id,
    title: task.title,
    prompt: task.prompt,
    schedule: task.schedule,
    cron: task.cron,
    run_at: task.run_at,
    timezone: task.timezone,
    model: task.model || '跟随 Bot 默认模型',
    enabled: task.enabled,
    next_run_at: task.next_run_at,
    last_run_at: task.last_run_at,
    last_status: task.last_status,
    last_error: task.last_error,
  })
  return [
    {
      name: 'generate_image',
      label: '生成聊天图片',
      description:
        '用户明确要求画图或生成图片时调用已配置的生图服务。图片自动显示在当前回复中，不修改头像。不要伪造图片链接；失败时说明原因。每轮最多生成4张。此工具是文生图，不支持根据输入图像进行精确编辑。',
      parameters: Type.Object({
        prompt: Type.String({ minLength: 1, maxLength: 6000 }),
      }),
      execute: async (_id, params) => {
        if (++imageCalls > 4) throw new Error('每轮最多生成4张图片')
        const { data, ext } = await requestGeneratedImage(
          (params as { prompt: string }).prompt,
          parentSignal,
        )
        parentSignal?.throwIfAborted()
        const attachment = storeChatImage(data, `生成图片.${ext}`)
        onImages?.([attachment])
        return {
          content: [
            {
              type: 'text' as const,
              text: '图片已生成并显示在你的回复中，无需重复插入链接。',
            },
            imageContent(attachment),
          ],
          details: { attachment },
        }
      },
    },
    {
      name: 'list_bots',
      label: '查看 Bot 名单',
      description:
        '查看可用 Bot 的 ID、名称、人设描述和置顶状态，不包含任何 API 密钥。',
      parameters: Type.Object({}),
      execute: async () =>
        result(
          db.listBots().map((b) => ({
            id: b.id,
            name: b.name,
            description: b.description,
            pinned: !!b.pinned,
          })),
        ),
    },
    {
      name: 'update_bot',
      label: '修改 Bot 设定',
      description:
        '按用户明确要求修改当前或指定 Bot 的名称、简介、人设、emoji 头像或置顶状态。最多置顶3个。用户只是讨论时不要修改。生成图片头像请用 generate_bot_avatar。',
      parameters: Type.Object({
        bot_id: optionalId,
        name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
        description: Type.Optional(Type.String({ maxLength: 2000 })),
        system_prompt: Type.Optional(Type.String({ maxLength: 12000 })),
        avatar_emoji: Type.Optional(Type.String({ maxLength: 16 })),
        pinned: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        parentSignal?.throwIfAborted()
        const p = params as {
          bot_id?: string
          name?: string
          description?: string
          system_prompt?: string
          avatar_emoji?: string
          pinned?: boolean
        }
        const patch: Partial<BotInput> = {}
        for (const key of [
          'name',
          'description',
          'system_prompt',
          'pinned',
        ] as const)
          if (p[key] !== undefined) Object.assign(patch, { [key]: p[key] })
        if (p.avatar_emoji) patch.avatar = 'emoji:' + p.avatar_emoji
        const bot = db.updateBot(p.bot_id || botId, patch)
        const updated =
          (p.name || p.description || p.system_prompt) && !p.avatar_emoji
            ? refreshAutomaticAvatar(bot)
            : bot
        return result({
          id: updated.id,
          name: updated.name,
          description: updated.description,
          avatar: updated.avatar,
          pinned: !!updated.pinned,
        })
      },
    },
    {
      name: 'expand_avatar_prompt',
      label: '设计头像提示词',
      description:
        '根据 Bot 名称与人设扩写头像画面、风格、构图和配色；生成前可先使用这个工具。',
      parameters: Type.Object({
        bot_id: optionalId,
        direction: Type.Optional(Type.String({ maxLength: 2000 })),
      }),
      execute: async (_id, params) => {
        const p = params as { bot_id?: string; direction?: string }
        return result(
          await expandAvatarPrompt(
            p.bot_id || botId,
            p.direction,
            parentSignal,
          ),
        )
      },
    },
    {
      name: 'generate_bot_avatar',
      label: '生成并应用头像',
      description:
        '生成并设置 Bot 头像。local 为本地风格化 SVG；image 调用用户配置的生图服务；auto 在配置完整时使用生图，否则使用本地。返回实际模式，不要把本地头像描述成模型生图。',
      parameters: Type.Object({
        bot_id: optionalId,
        prompt: Type.Optional(Type.String({ maxLength: 4000 })),
        mode: Type.Optional(
          Type.Union([
            Type.Literal('auto'),
            Type.Literal('local'),
            Type.Literal('image'),
          ]),
        ),
      }),
      execute: async (_id, params) => {
        const p = params as {
          bot_id?: string
          prompt?: string
          mode?: AvatarMode
        }
        return result(
          await generateBotAvatar(
            p.bot_id || botId,
            p.prompt,
            p.mode,
            parentSignal,
          ),
        )
      },
    },
    {
      name: 'read_user_profile',
      label: '了解用户',
      description: '读取用户主动填写的个人资料和所有 Bot 共享的用户记忆。',
      parameters: Type.Object({}),
      execute: async () => {
        const { avatar: _avatar, ...profile } = db.getUserProfile()
        return result({ profile, memories: db.listUserMemories(60) })
      },
    },
    {
      name: 'remember_user',
      label: '记住用户信息',
      description:
        '保存用户直接表达且适合长期记住的事实、偏好或目标，供所有 Bot 使用。不要保存猜测、其他 Bot 推断或密钥。用户可在关于我里查看、修改、删除。',
      parameters: Type.Object({
        content: Type.String({ minLength: 1, maxLength: 1000 }),
        kind: Type.Optional(
          Type.Union([
            Type.Literal('fact'),
            Type.Literal('preference'),
            Type.Literal('summary'),
          ]),
        ),
      }),
      execute: async (_id, params) => {
        parentSignal?.throwIfAborted()
        const p = params as { content: string; kind?: MemoryKind }
        return result(db.saveUserMemory(p.content, p.kind, 'agent', botId))
      },
    },
    {
      name: 'list_scheduled_tasks',
      label: '查看定时任务',
      description:
        '查看当前 Bot 在本会话设置的定时 Agent 任务、下次执行时间和最近状态。需要修改或删除前先调用它获取准确任务 ID。',
      parameters: Type.Object({}),
      execute: async () => result(db.listScheduledTasks(botId).map(taskSummary)),
    },
    {
      name: 'create_scheduled_task',
      label: '创建定时任务',
      description:
        '用户的自然语言中只要同时出现时间和要做事项，即视为创建请求，例如“每天晚上20点问好”应创建 cron="0 20 * * *"、任务为向当前会话问好。任务只归当前 Bot，结果会投递到当前会话。schedule=once 时必须给未来的 Unix 毫秒 run_at；schedule=cron 时必须给 5 段或 6 段 Cron（如每天 9:00 为 "0 9 * * *"，每周一 9:00 为 "0 9 * * 1"）。model 留空表示继承当前 Bot 的模型设置。创建后准确回报计划和下次时间，不要声称已设置但没有调用工具。',
      parameters: Type.Object({
        title: Type.String({ minLength: 1, maxLength: 120 }),
        prompt: Type.String({ minLength: 1, maxLength: 8000 }),
        schedule: Type.Union([Type.Literal('once'), Type.Literal('cron')]),
        run_at: Type.Optional(Type.Integer({ minimum: 1 })),
        cron: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        timezone: Type.Optional(Type.String({ maxLength: 100 })),
        model: Type.Optional(Type.String({ maxLength: 300 })),
      }),
      execute: async (_id, params) => {
        parentSignal?.throwIfAborted()
        const p = params as {
          title: string
          prompt: string
          schedule: ScheduledTask['schedule']
          run_at?: number
          cron?: string
          timezone?: string
          model?: string
        }
        const task = db.saveScheduledTask({
          bot_id: botId,
          chat_id: chatId,
          title: p.title,
          prompt: p.prompt,
          schedule: p.schedule,
          run_at: p.run_at,
          cron: p.cron,
          timezone: p.timezone,
          model: p.model,
        })
        observeScheduledTaskChange('created', task)
        refreshScheduledTasks()
        return result(taskSummary(task))
      },
    },
    {
      name: 'update_scheduled_task',
      label: '修改定时任务',
      description:
        '仅按用户明确要求修改当前 Bot 自己的定时任务，例如暂停、恢复、改时间、改任务指令或切换模型。先调用 list_scheduled_tasks；任务 ID 不属于当前 Bot 时拒绝。',
      parameters: Type.Object({
        task_id: Type.String(),
        title: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        prompt: Type.Optional(Type.String({ minLength: 1, maxLength: 8000 })),
        schedule: Type.Optional(
          Type.Union([Type.Literal('once'), Type.Literal('cron')]),
        ),
        run_at: Type.Optional(Type.Integer({ minimum: 1 })),
        cron: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
        timezone: Type.Optional(Type.String({ maxLength: 100 })),
        model: Type.Optional(Type.String({ maxLength: 300 })),
        enabled: Type.Optional(Type.Boolean()),
      }),
      execute: async (_id, params) => {
        parentSignal?.throwIfAborted()
        const p = params as {
          task_id: string
          title?: string
          prompt?: string
          schedule?: ScheduledTask['schedule']
          run_at?: number
          cron?: string
          timezone?: string
          model?: string
          enabled?: boolean
        }
        const existing = db.getScheduledTask(p.task_id)
        if (!existing || existing.bot_id !== botId)
          throw new Error('只能修改当前 Bot 的定时任务')
        const task = db.saveScheduledTask({
          id: existing.id,
          bot_id: existing.bot_id,
          chat_id: existing.chat_id,
          title: p.title ?? existing.title,
          prompt: p.prompt ?? existing.prompt,
          schedule: p.schedule ?? existing.schedule,
          run_at: p.run_at ?? existing.run_at,
          cron: p.cron ?? existing.cron,
          timezone: p.timezone ?? existing.timezone,
          model: p.model ?? existing.model,
          enabled: p.enabled ?? existing.enabled,
        })
        observeScheduledTaskChange('updated', task)
        refreshScheduledTasks()
        return result(taskSummary(task))
      },
    },
    {
      name: 'delete_scheduled_task',
      label: '删除定时任务',
      description:
        '仅在用户明确要求删除或取消当前 Bot 的定时任务时调用。先查看任务列表确认 ID；不允许删除其他 Bot 的任务。',
      parameters: Type.Object({ task_id: Type.String() }),
      execute: async (_id, params) => {
        const taskId = (params as { task_id: string }).task_id
        const task = db.getScheduledTask(taskId)
        if (!task || task.bot_id !== botId)
          throw new Error('只能删除当前 Bot 的定时任务')
        observeScheduledTaskChange('deleted', task)
        db.deleteScheduledTask(taskId)
        refreshScheduledTasks()
        return result({ id: taskId, deleted: true })
      },
    },
    {
      name: 'agent_private_chat',
      label: '和另一位 Bot 私聊',
      description:
        '向另一个 Bot 私下咨询，并等待其回复。先用 list_bots 获取ID。双方真实消息自动保存，在主会话中插入可打开的私聊卡片。每次用户请求最多调用3次，对方不能递归发起私聊。',
      parameters: Type.Object({
        to_bot_id: Type.String(),
        message: Type.String({ minLength: 1, maxLength: 12000 }),
      }),
      execute: async (_id, params) => {
        if (++privateCalls > 3)
          throw new Error('本轮已达到3次私聊上限，请汇总已有结果')
        const p = params as { to_bot_id: string; message: string }
        const { thread, finished } = beginAgentConversation(
          chatId,
          botId,
          p.to_bot_id,
          p.message,
          parentSignal,
        )
        return result({
          thread_id: thread.id,
          reply: await finished,
          note: '私聊完整记录已插入当前用户会话',
        })
      },
    },
  ]
}
