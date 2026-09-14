import {
  GROUP_BACKGROUNDS,
  isGroupBackground,
} from '../../../shared/groupBackgrounds'

export { GROUP_BACKGROUNDS }

export function groupBackgroundUrl(file: string): string {
  if (!isGroupBackground(file)) return ''
  return `covan-bg://builtin/${encodeURIComponent(file)}`
}
