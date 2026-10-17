import { useEffect, useState } from 'react'
import type { BotGender, PresetAvatar } from '@shared/types'
import { api } from '../lib/api'
import { Avatar } from './Avatar'

export function usePresetAvatars() {
  const [presets, setPresets] = useState<PresetAvatar[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    let request = 0
    const refresh = () => {
      const current = ++request
      setPresets([])
      api
        .listPresetAvatars()
        .then((items) => {
          if (active && current === request) {
            setPresets(items)
            setError('')
          }
        })
        .catch((e) => {
          if (active && current === request) setError(String(e))
        })
    }
    refresh()
    const off = api.onEvent((event) => {
      if (event.type === 'user-context-updated') refresh()
    })
    return () => {
      active = false
      off()
    }
  }, [])
  return { presets, error }
}

export function GenderPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: BotGender
  onChange: (gender: BotGender) => void
  disabled?: boolean
}) {
  return (
    <div className="gender-picker" role="group" aria-label="Bot 性别">
      {(['female', 'male'] as const).map((gender) => (
        <button
          key={gender}
          type="button"
          disabled={disabled}
          aria-pressed={value === gender}
          onClick={() => onChange(gender)}
        >
          {gender === 'female' ? '♀ 女生' : '♂ 男生'}
        </button>
      ))}
    </div>
  )
}

export function PresetAvatarPicker({
  presets,
  gender,
  value,
  onChange,
  disabled = false,
}: {
  presets: PresetAvatar[]
  gender: BotGender
  value: string
  onChange: (preset: PresetAvatar) => void
  disabled?: boolean
}) {
  return (
    <div className="preset-avatar-grid" role="group" aria-label="内置头像">
      {presets
        .filter((p) => p.gender === gender)
        .map((preset) => (
          <button
            type="button"
            key={preset.id}
            disabled={disabled}
            aria-label={`选择${preset.label}头像`}
            aria-pressed={value === preset.avatar}
            className="shape-rect"
            onClick={() => onChange(preset)}
          >
            <span className="preset-portrait">
              <Avatar name={preset.label} avatar={preset.avatar} size={64} />
              {value === preset.avatar && (
                <span className="preset-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </span>
            <span>{preset.label}</span>
            {preset.lifestyle.length > 0 && (
              <small>{preset.lifestyle.length} 张生活照</small>
            )}
          </button>
        ))}
      {!presets.some((p) => p.gender === gender) && (
        <p className="col-span-3 text-center text-xs text-stone-400">
          暂无可用内置头像
        </p>
      )}
    </div>
  )
}
