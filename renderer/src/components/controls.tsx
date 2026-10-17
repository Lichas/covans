// components/controls.tsx — 复用的小控件：开关、表单标签、按钮
export function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  label?: string
}) {
  return (
    <button
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition ${
        checked ? 'bg-emerald-500' : 'bg-stone-300 dark:bg-stone-600'
      } ${disabled ? 'opacity-50' : ''}`}
    >
      <span
        className={`inline-block h-[16px] w-[16px] transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]'
        }`}
      />
    </button>
  )
}

export function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-stone-500 dark:text-stone-400">
        {label}
      </span>
      {children}
    </label>
  )
}

export const inputCls =
  'selectable w-full rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[13px] text-stone-800 outline-none transition focus:border-stone-400 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100 dark:focus:border-stone-500'

export const btnPrimaryCls =
  'rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-white transition hover:bg-stone-700 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-300'

export const btnGhostCls =
  'rounded-full border border-stone-300 px-3.5 py-1.5 text-[13px] text-stone-600 transition hover:bg-stone-100 disabled:opacity-40 dark:border-stone-600 dark:text-stone-300 dark:hover:bg-stone-700'
