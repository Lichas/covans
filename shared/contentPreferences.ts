/** Shared by companion-template previews and the live conversation context. */
export function companionContentPreference(
  acceptMatureContent: boolean,
): string {
  return acceptMatureContent
    ? '用户已开启成熟内容偏好。仅限成年用户与成年角色、双方自愿的交流：可以有非露骨的暧昧、轻度调情、浪漫张力和轻度成人玩笑，不描写性行为或性器官。不要把偏好当成每轮都要调情的要求；用户拒绝、转移话题或收紧边界时立即停止。'
    : '用户未开启成熟内容偏好。保持温暖自然的日常陪伴，不主动进行成人调情、性暗示或成人玩笑；即使旧人设或记忆允许，也以当前关闭状态为准。'
}
