import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Attachment } from '../shared/types'
import { getWorkspaceRoot } from './workspace'

export const MAX_CHAT_IMAGES = 8
export const MAX_IMAGE_BYTES = 16 * 1024 * 1024
function root(): string {
  return path.join(path.dirname(getWorkspaceRoot()), 'chat-images')
}

function imageType(data: Buffer): { mime: string; ext: string } {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return { mime: 'image/png', ext: 'png' }
  if (data[0] === 255 && data[1] === 216 && data[2] === 255)
    return { mime: 'image/jpeg', ext: 'jpg' }
  if (/^GIF8[79]a/.test(data.toString('ascii', 0, 6)))
    return { mime: 'image/gif', ext: 'gif' }
  if (
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP'
  )
    return { mime: 'image/webp', ext: 'webp' }
  throw new Error('请选择 PNG、JPEG、WebP 或 GIF 图片')
}

export function storeChatImage(data: Buffer, name: string): Attachment {
  if (!data.length || data.length > MAX_IMAGE_BYTES)
    throw new Error('每张图片最多 16MB')
  const { mime, ext } = imageType(data)
  fs.mkdirSync(root(), { recursive: true })
  const file = `${randomUUID()}.${ext}`
  fs.writeFileSync(path.join(root(), file), data)
  return {
    path: `chat-images/${file}`,
    name: path.basename(name || file).slice(0, 200),
    mime,
  }
}

export function chatImagePath(relative: string): string {
  if (!/^chat-images\/[a-f0-9-]+\.(png|jpg|webp|gif)$/.test(relative))
    throw new Error('无效的聊天图片')
  const file = path.join(root(), path.basename(relative))
  if (!fs.realpathSync(file).startsWith(fs.realpathSync(root()) + path.sep))
    throw new Error('无效的聊天图片路径')
  return file
}

export function validateChatImages(value: Attachment[]): Attachment[] {
  if (!Array.isArray(value) || value.length > MAX_CHAT_IMAGES)
    throw new Error(`每条消息最多 ${MAX_CHAT_IMAGES} 张图片`)
  return value.map((item) => {
    if (!item || typeof item.path !== 'string')
      throw new Error('无效的图片附件')
    const file = chatImagePath(item.path)
    const stat = fs.statSync(file)
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES)
      throw new Error('图片不可用或超过 16MB')
    const { mime } = imageType(fs.readFileSync(file))
    return {
      path: item.path,
      mime,
      name: String(item.name || path.basename(file)).slice(0, 200),
    }
  })
}

export function imageContent(attachment: Attachment) {
  return {
    type: 'image' as const,
    data: fs.readFileSync(chatImagePath(attachment.path)).toString('base64'),
    mimeType: attachment.mime,
  }
}
