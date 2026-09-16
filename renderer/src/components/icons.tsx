// components/icons.tsx — 内联 SVG 图标（heroicons 风格手写简版）
import type { CSSProperties, HTMLAttributes, SVGProps } from 'react'
import type { ProviderKind } from '@shared/types'
export { Quote as QuoteIcon, Bug as BugIcon } from 'lucide-react'
import anthropicIcon from '../assets/provider-icons/anthropic.svg'
import deepseekIcon from '../assets/provider-icons/deepseek.svg'
import googleIcon from '../assets/provider-icons/google.svg'
import kimiIcon from '../assets/provider-icons/kimi.svg'
import lmStudioIcon from '../assets/provider-icons/lm-studio.svg'
import mockIcon from '../assets/provider-icons/mock.svg'
import openaiCompatibleIcon from '../assets/provider-icons/openai-compatible.svg'
import openaiIcon from '../assets/provider-icons/openai.svg'
import openrouterIcon from '../assets/provider-icons/openrouter.svg'
import zhipuIcon from '../assets/provider-icons/zhipu.svg'

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

export const ClockIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7v5l3.5 2" />
  </svg>
)

export const PlayIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="m9 6 9 6-9 6z" fill="currentColor" stroke="none" />
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

export const UserPlusIcon = (p: P) => (
  <svg {...base(p)}>
    <circle cx="9" cy="8" r="3.5" />
    <path d="M2.5 20c.8-3.2 3.4-5 6.5-5 1.7 0 3.2.5 4.3 1.5" />
    <path d="M18 11v8m-4-4h8" />
  </svg>
)

export const EyeOffIcon = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 3l18 18M10.6 10.7A2 2 0 0 0 13.3 13.4M9.9 5.2A10.6 10.6 0 0 1 12 5c5.4 0 8.7 5.1 9.5 7-.4 1-1.4 2.7-3 4.1M6.1 6.1C4.1 7.6 2.9 9.7 2.5 12c.8 1.9 4.1 7 9.5 7 1.2 0 2.4-.3 3.4-.7" />
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
  { color: string; source: string }
> = {
  openai: { color: '#111111', source: openaiIcon },
  anthropic: { color: '#c15f35', source: anthropicIcon },
  google: { color: '#4285f4', source: googleIcon },
  openrouter: { color: '#111111', source: openrouterIcon },
  kimi: { color: '#1677ff', source: kimiIcon },
  zhipu: { color: '#2b6af5', source: zhipuIcon },
  deepseek: { color: '#4d6bfe', source: deepseekIcon },
  'lm-studio': { color: '#7457e8', source: lmStudioIcon },
  'openai-compatible': { color: '#6b7280', source: openaiCompatibleIcon },
  mock: { color: '#8a8a8a', source: mockIcon },
}

type ProviderIconProps = Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'width' | 'height'
> & {
  kind: ProviderKind
  width?: number | string
  height?: number | string
}

/** Provider 标识图标：使用随应用打包的厂商图形，不在运行时请求网络。 */
export function ProviderIcon({
  kind,
  width = 20,
  height = 20,
  className,
  style,
  ...props
}: ProviderIconProps) {
  const meta = PROVIDER_ICON_META[kind]
  return (
    <span
      {...props}
      aria-hidden="true"
      className={`provider-icon ${className ?? ''}`}
      data-provider-kind={kind}
      style={
        {
          ...style,
          width,
          height,
          '--provider-icon-color': meta.color,
          '--provider-icon-source': `url("${meta.source}")`,
        } as CSSProperties
      }
    >
      <span className="provider-icon-mark" />
    </span>
  )
}
