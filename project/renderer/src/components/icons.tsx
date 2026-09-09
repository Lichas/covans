// components/icons.tsx — 内联 SVG 图标（heroicons 风格手写简版）
import type { SVGProps } from 'react'
import type { ProviderKind } from '@shared/types'

type P = SVGProps<SVGSVGElement>

export const CopyIcon = (p: P) => (
  <svg {...base(p)}>
    <rect x="8" y="8" width="12" height="13" rx="2" />
    <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
  </svg>
)
export const ArrowDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 4v16m-6-6 6 6 6-6" />
  </svg>
)
export const QuoteIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 6h6v6H5c0 3 1 4 3 5M14 6h6v6h-5c0 3 1 4 3 5" />
  </svg>
)
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3v12m-4-4 4 4 4-4M4 15v5h16v-5" />
  </svg>
)
export const SparkIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3z" />
  </svg>
)

function base(props: P) {
  return {
    width: 20,
    height: 20,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  }
}

export const PlusIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const SearchIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const GearIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1-1.55 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.55-1 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34h.01a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87v.01a1.7 1.7 0 0 0 1.55 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.55 1z" />
  </svg>
)

export const ChatIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z" />
  </svg>
)

export const UsersIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.2 3.4-5 6.5-5s5.7 1.8 6.5 5" />
    <circle cx="17" cy="9" r="2.6" />
    <path d="M16.5 15.3c2.6.3 4.4 1.8 5 4.7" />
  </svg>
)

export const MarketIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 9 5.5 4h13L20 9" />
    <path d="M4 9h16v3a2.5 2.5 0 0 1-5 0 2.5 2.5 0 0 1-6 0 2.5 2.5 0 0 1-5 0z" />
    <path d="M5.5 14.5V20h13v-5.5" />
  </svg>
)

export const MeIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c1-4.2 4.3-6.5 8-6.5s7 2.3 8 6.5" />
  </svg>
)

export const SendIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M21 3 10 14" />
    <path d="M21 3 14 21l-4-7-7-4z" />
  </svg>
)

export const StopIcon = (p: P) => (
  <svg {...base(p)}>
    <rect
      x="7"
      y="7"
      width="10"
      height="10"
      rx="2"
      fill="currentColor"
      stroke="none"
    />
  </svg>
)

export const AtIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
  </svg>
)

export const AttachIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m21 12.5-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8L13 5a3.7 3.7 0 0 1 5.2 5.2l-8.2 8.2a1.85 1.85 0 0 1-2.6-2.6L15 8" />
  </svg>
)

export const CloseIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const ExpandIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
  </svg>
)

export const ShareIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="6" r="2.5" />
    <circle cx="18" cy="18" r="2.5" />
    <path d="m8.2 10.8 7.6-3.6M8.2 13.2l7.6 3.6" />
  </svg>
)

export const TrashIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 7h16M10 7V4h4v3M6 7l1 13h10l1-13" />
    <path d="M10 11v5M14 11v5" />
  </svg>
)

export const FolderIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

export const FileIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 2h8l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" />
    <path d="M14 2v5h5" />
  </svg>
)

export const RefreshIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    <path d="M20 4v5h-5" />
  </svg>
)

export const CheckIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m5 13 4 4L19 7" />
  </svg>
)

export const WarnIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M12 3 2 20h20z" />
    <path d="M12 10v4M12 17.5v.01" />
  </svg>
)

export const ChevronDownIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const PencilIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
  </svg>
)

const PROVIDER_ICON_META: Record<
  ProviderKind,
  { color: string; glyph: string }
> = {
  openai: { color: '#18181b', glyph: 'O' },
  anthropic: { color: '#c2410c', glyph: 'A' },
  google: { color: '#4285f4', glyph: 'G' },
  openrouter: { color: '#7c3aed', glyph: '◇' },
  kimi: { color: '#1677ff', glyph: 'K' },
  zhipu: { color: '#2563eb', glyph: '智' },
  deepseek: { color: '#0891b2', glyph: 'D' },
  'lm-studio': { color: '#7457e8', glyph: 'LM' },
  'openai-compatible': { color: '#57534e', glyph: '↔' },
  mock: { color: '#a8a29e', glyph: 'M' },
}

/** Provider 标识图标：内联 SVG，避免依赖外部图片和网络资源。 */
export function ProviderIcon({ kind, ...props }: P & { kind: ProviderKind }) {
  const meta = PROVIDER_ICON_META[kind]
  const size = typeof props.width === 'number' ? props.width : 20
  return (
    <svg {...base({ ...props, stroke: 'none' })} aria-hidden="true">
      <rect x="1" y="1" width="22" height="22" rx="6" fill={meta.color} />
      <text
        x="12"
        y="16"
        textAnchor="middle"
        fill="white"
        fontSize={meta.glyph === '智' || meta.glyph.length > 1 ? 8.5 : size <= 18 ? 12 : 13}
        fontFamily="-apple-system, BlinkMacSystemFont, 'PingFang SC', sans-serif"
        fontWeight="700"
      >
        {meta.glyph}
      </text>
    </svg>
  )
}
