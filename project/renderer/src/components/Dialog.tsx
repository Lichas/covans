// components/Dialog.tsx — 通用模态框容器
import { useEffect } from 'react'
import { CloseIcon } from './icons'

interface Props {
  open: boolean
  title: string
  width?: string
  onClose: () => void
  children: React.ReactNode
}

export function Dialog({ open, title, width = 'w-[520px]', onClose, children }: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className={`${width} max-h-[85vh] animate-fadeIn overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-800`}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3.5 dark:border-stone-700">
          <h2 className="text-[15px] font-semibold text-stone-800 dark:text-stone-100">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            aria-label="关闭"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div className="scroll-thin max-h-[calc(85vh-52px)] overflow-y-auto">{children}</div>
      </div>
    </div>
  )
}
