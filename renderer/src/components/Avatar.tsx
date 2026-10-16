// components/Avatar.tsx — Bot 头像：emoji / covan-avatar 协议图 / 首字彩色占位
import { useEffect, useState } from 'react'
import { avatarColor, avatarSrc, botInitial } from '../lib/format'

interface Props {
  name: string
  avatar: string
  size?: number
  online?: boolean
  /** Agent 正在准备、回复或执行工作时显示状态环。 */
  activity?: boolean
  className?: string
}

export function Avatar({
  name,
  avatar,
  size = 40,
  online,
  activity = false,
  className = '',
}: Props) {
  const [imgError, setImgError] = useState(false)
  useEffect(() => setImgError(false), [avatar])
  const src = avatarSrc(avatar)
  const dim = { width: size, height: size }

  let inner: React.ReactNode
  if (src.kind === 'emoji') {
    inner = (
      <span style={{ fontSize: size * 0.55, lineHeight: 1 }} className="select-none">
        {src.char}
      </span>
    )
  } else if (src.kind === 'url' && !imgError) {
    inner = (
      <img
        src={src.url}
        alt={name}
        className="h-full w-full object-cover"
        draggable={false}
        onError={() => setImgError(true)}
      />
    )
  } else {
    inner = (
      <span style={{ fontSize: size * 0.42 }} className="select-none font-medium">
        {botInitial(name)}
      </span>
    )
  }

  const showFallbackBg = src.kind === 'none' || (src.kind === 'url' && imgError)

  return (
    <span
      className={`relative inline-block shrink-0 ${activity ? 'avatar-working' : ''} ${className}`}
      data-avatar-activity={activity ? 'active' : undefined}
      style={dim}
    >
      <span
        className={`flex h-full w-full items-center justify-center overflow-hidden rounded-full ${
          showFallbackBg ? avatarColor(name) : 'bg-stone-200 dark:bg-stone-700'
        }`}
      >
        {inner}
      </span>
      {online && (
        <span
          className="absolute bottom-0 right-0 rounded-full border-2 border-white bg-emerald-500 dark:border-stone-900"
          style={{ width: Math.max(8, size * 0.28), height: Math.max(8, size * 0.28) }}
        />
      )}
    </span>
  )
}
