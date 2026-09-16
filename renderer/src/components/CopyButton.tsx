import { useEffect, useRef, useState, type ReactNode } from 'react'
import { CheckIcon, CopyIcon } from './icons'
import { api } from '../lib/api'

export function CopyButton({
  text,
  label = '复制消息',
  compact = false,
  icon,
}: {
  text: string | (() => string)
  label?: string
  compact?: boolean
  icon?: ReactNode
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await api.writeClipboard(typeof text === 'function' ? text() : text)
      setState('copied')
    } catch {
      setState('error')
    }
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setState('idle'), 2000)
  }
  const title =
    state === 'copied'
      ? '已复制'
      : state === 'error'
        ? '复制失败，请重试'
        : label
  return (
    <button
      className="message-action"
      onClick={() => void copy()}
      aria-label={title}
      title={title}
    >
      {state === 'copied' ? (
        <CheckIcon width={14} height={14} />
      ) : (
        icon ?? <CopyIcon width={14} height={14} />
      )}
      {(!compact || state !== 'idle') && <span role="status">{title}</span>}
    </button>
  )
}
