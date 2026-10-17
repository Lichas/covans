import { useState } from 'react'
import { Monitor, Moon, Sun } from 'lucide-react'
import { useSettingsStore, type ThemeMode } from '../stores/settingsStore'

const themes = [
  { value: 'light', label: '浅色', icon: Sun, description: '白底 · 中性灰' },
  { value: 'dark', label: '深色', icon: Moon, description: '近黑 · 中性灰' },
  { value: 'system', label: '跟随系统', icon: Monitor, description: '随你的设备变化' },
] as const

export function ThemeSwitcher({ compact = false }: { compact?: boolean }) {
  const theme = useSettingsStore((s) => s.theme)
  const loaded = useSettingsStore((s) => s.loaded)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const changeTheme = async (value: ThemeMode) => {
    setSaving(true)
    setError('')
    try {
      await setTheme(value)
    } catch {
      setError('主题未能保存，请重试')
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className={compact ? 'theme-dock-wrap' : 'theme-picker-wrap'}>
      <div className={compact ? 'theme-dock' : 'theme-picker'} role="group" aria-label="外观主题">
        {compact && <span className="theme-dock-label">外观</span>}
        {themes.map(({ value, label, icon: Icon, description }) => (
          <button
            key={value}
            type="button"
            className="shape-rect"
            aria-label={compact ? `切换到${label}主题` : label}
            title={label}
            aria-pressed={theme === value}
            disabled={!loaded || saving}
            onClick={() => void changeTheme(value)}
          >
            {!compact && <span className={`theme-preview theme-preview-${value}`} aria-hidden="true"><i /><i /><i /></span>}
            <span className="theme-option-label"><Icon size={16} strokeWidth={1.7} />{!compact && label}</span>
            {!compact && <small>{description}</small>}
          </button>
        ))}
      </div>
      {error && <p className="theme-error" role="alert">{error}</p>}
    </div>
  )
}
