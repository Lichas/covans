import { useEffect, useState } from 'react'
import type { Bot, PresetAvatar } from '@shared/types'
import { avatarSrc } from '../lib/format'
import { usePresetAvatars } from './PresetAvatarPicker'

function LifestyleCarousel({
  preset,
  name,
}: {
  preset: PresetAvatar
  name: string
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [hidden, setHidden] = useState(document.hidden)
  const [reducedMotion, setReducedMotion] = useState(
    () => matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [failed, setFailed] = useState<string[]>([])
  const photos = preset.lifestyle.filter((photo) => !failed.includes(photo))
  const current = index % (photos.length || 1)
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const changed = () => setReducedMotion(media.matches)
    const visibility = () => setHidden(document.hidden)
    media.addEventListener('change', changed)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      media.removeEventListener('change', changed)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [])
  useEffect(() => {
    if (
      photos.length < 2 ||
      paused ||
      hovered ||
      focused ||
      hidden ||
      reducedMotion
    )
      return
    const timer = setInterval(
      () => setIndex((i) => (i + 1) % photos.length),
      5000,
    )
    return () => clearInterval(timer)
  }, [photos.length, paused, hovered, focused, hidden, reducedMotion, index])
  if (!photos.length) return null
  const move = (delta: number) =>
    setIndex((current + delta + photos.length) % photos.length)
  return (
    <section
      className="lifestyle-showcase"
      aria-label={`${name}的生活照`}
      aria-roledescription="照片轮播"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setFocused(false)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          move(event.key === 'ArrowLeft' ? -1 : 1)
        }
      }}
    >
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <span className="min-w-0 truncate pr-2 text-xs font-medium text-stone-500 dark:text-stone-400">
          生活里的 {name}
        </span>
        <span className="shrink-0 text-[10px] tracking-[0.16em] text-stone-400">
          LIFE MOMENTS
        </span>
      </div>
      <div className="lifestyle-frame">
        {photos.map((photo, i) => {
          const src = avatarSrc(photo)
          return (
            src.kind === 'url' && (
              <img
                key={photo}
                src={src.url}
                alt={`${name}的生活照 ${i + 1}`}
                aria-hidden={i !== current}
                className={i === current ? 'is-active' : ''}
                onError={() => setFailed((items) => [...items, photo])}
              />
            )
          )
        })}
        <div className="lifestyle-shade" />
        <div className="lifestyle-caption">
          <span>日常片刻</span>
          <span className="tabular-nums">
            {String(current + 1).padStart(2, '0')} /{' '}
            {String(photos.length).padStart(2, '0')}
          </span>
        </div>
        {photos.length > 1 && (
          <div className="lifestyle-controls">
            <button
              type="button"
              aria-label="上一张生活照"
              title="上一张"
              onClick={() => move(-1)}
            >
              ‹
            </button>
            <div
              className="lifestyle-dots"
              role="group"
              aria-label="选择生活照"
            >
              {photos.map((photo, i) => (
                <button
                  key={photo}
                  type="button"
                  aria-label={`查看第 ${i + 1} 张生活照`}
                  aria-pressed={current === i}
                  onClick={() => setIndex(i)}
                >
                  <span />
                </button>
              ))}
            </div>
            {!reducedMotion && (
              <button
                type="button"
                aria-label={paused ? '播放生活照' : '暂停生活照'}
                title={paused ? '播放' : '暂停'}
                onClick={() => setPaused(!paused)}
              >
                {paused ? '▷' : 'Ⅱ'}
              </button>
            )}
            <button
              type="button"
              aria-label="下一张生活照"
              title="下一张"
              onClick={() => move(1)}
            >
              ›
            </button>
          </div>
        )}
      </div>
    </section>
  )
}

export function AvatarLifestyle({ bot }: { bot: Bot }) {
  const { presets, error } = usePresetAvatars()
  const preset = presets.find((p) => p.avatar === bot.avatar)
  if (!preset?.lifestyle.length)
    return (
      <div className="px-6 py-12 text-center">
        <p
          role={error ? 'alert' : 'status'}
          className="text-[13px] text-stone-500 dark:text-stone-400"
        >
          {error || '当前头像暂无可展示的生活照'}
        </p>
        {!error && (
          <p className="mt-2 text-[12px] leading-relaxed text-stone-400">
            选择带生活照的内置头像后，即可在这里查看。
          </p>
        )}
      </div>
    )
  return (
    <LifestyleCarousel
      key={`${bot.id}:${preset.id}`}
      preset={preset}
      name={bot.name}
    />
  )
}
