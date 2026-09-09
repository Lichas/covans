import { Type } from '@earendil-works/pi-ai'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import type { BotInput, MemoryKind } from '../shared/types'
import * as db from './db'
import {
  expandAvatarPrompt,
  generateBotAvatar,
  refreshAutomaticAvatar,
  type AvatarMode,
} from './avatars'
import { beginAgentConversation } from './privateConversations'

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
): AgentTool[] {
  let privateCalls = 0
  return [
    {
      name: 'list_bots',
      label: '查看 Bot 名单',
      description:
        '查看可用 Bot 的 ID、名称、人设描述和置顶状态，不包含任何 API 密钥。',
      parameters: Type.Object({}),
      execute: async () =>
        result(
          db
            .listBots()
            .map((b) => ({
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
      execute: async () =>
        result({
          profile: db.getUserProfile(),
          memories: db.listUserMemories(60),
        }),
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
