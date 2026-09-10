import type { PresetAvatar } from './types'

/** Bundled character identities; file names remain stable across releases. */
export const PRESET_AVATARS: Omit<PresetAvatar, 'lifestyle'>[] = [
  ['01', 'female', '暖杏'],
  ['02', 'male', '晴空'],
  ['03', 'female', '浅夏'],
  ['04', 'male', '青柠'],
  ['05', 'male', '暮柔'],
  ['06', 'female', '朝露'],
  ['07', 'male', '远山'],
  ['08', 'female', '珊瑚'],
  ['09', 'male', '深海'],
  ['10', 'female', '玫瑰'],
  ['11', 'male', '琥珀'],
  ['12', 'female', '绯樱'],
].map(([number, gender, label]) => ({
  id: `avatar-${number}`,
  label,
  gender: gender as PresetAvatar['gender'],
  avatar: `avatars/preset/avatar-${number}-original.png`,
}))
