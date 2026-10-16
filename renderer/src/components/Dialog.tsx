// components/Dialog.tsx — 通用模态框容器
import { useEffect, useId, useRef } from 'react'
import { CloseIcon } from './icons'

interface Props {
  open: boolean
  title: string
  width?: string
  bodyClassName?: string
  onClose: () => void
  children: React.ReactNode
}

export function Dialog({
  open,
  title,
  width = 'w-[520px]',
  bodyClassName,
  onClose,
  children,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement as HTMLElement | null
    const focusable = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((el) => el.getClientRects().length > 0)
    if (!ref.current?.contains(document.activeElement))
      (focusable()[0] ?? ref.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        closeRef.current()
      }
      if (e.key === 'Tab') {
        const elements = focusable()
        const first = elements[0]
        const last = elements.at(-1)
        if (!first) {
          e.preventDefault()
          ref.current?.focus()
          return
        }
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault()
          last?.focus()
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            !ref.current?.contains(document.activeElement))
        ) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      previousFocus?.focus()
    }
  }, [open])

  if (!open) return null
  return (
    <div
      className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={`glass-dialog ${width} max-w-[92vw] max-h-[85vh] animate-fadeIn overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-xl dark:border-stone-700 dark:bg-stone-800`}
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3.5 dark:border-stone-700">
          <h2
            id={titleId}
            className="text-[15px] font-semibold text-stone-800 dark:text-stone-100"
          >
            {title}
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-stone-400 transition hover:bg-stone-100 hover:text-stone-600 dark:hover:bg-stone-700 dark:hover:text-stone-300"
            aria-label="关闭"
          >
            <CloseIcon width={18} height={18} />
          </button>
        </div>
        <div
          className={
            bodyClassName ??
            'scroll-thin max-h-[calc(85vh-52px)] overflow-y-auto'
          }
        >
          {children}
        </div>
      </div>
    </div>
  )
}
