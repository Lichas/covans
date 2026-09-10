import type { UserPresetAvatar } from './types'

/** Default portraits available only for the local user profile. */
export const USER_PRESET_AVATARS: UserPresetAvatar[] = Array.from(
  { length: 9 },
  (_, index) => {
    const number = String(index + 1).padStart(2, '0')
    return {
      id: `user-avatar-${number}`,
      label: `默认头像 ${index + 1}`,
      avatar: `avatars/user-preset/avatar-${number}.png`,
    }
  },
)
