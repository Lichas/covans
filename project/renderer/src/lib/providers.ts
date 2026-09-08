import type { ProviderKind } from '@shared/types'

export interface ProviderPreset {
  value: ProviderKind
  label: string
  baseUrl: string
  defaultModel: string
}

/** 可直接使用的 Provider 预设；模型仍可在表单中按账号权限覆盖。 */
export const PROVIDER_PRESETS: ProviderPreset[] = [
  { value: 'openai', label: 'OpenAI', baseUrl: '', defaultModel: '' },
  { value: 'anthropic', label: 'Anthropic', baseUrl: '', defaultModel: '' },
  { value: 'google', label: 'Google', baseUrl: '', defaultModel: '' },
  { value: 'openrouter', label: 'OpenRouter', baseUrl: '', defaultModel: '' },
  { value: 'kimi', label: 'Kimi Coding Plan', baseUrl: 'https://api.kimi.com/coding/v1', defaultModel: '' },
  { value: 'zhipu', label: '智谱', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', defaultModel: 'glm-5.2' },
  { value: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-v4-flash' },
  { value: 'openai-compatible', label: 'OpenAI 兼容（自定义 baseURL）', baseUrl: '', defaultModel: '' },
  { value: 'mock', label: 'Mock（本地测试）', baseUrl: '', defaultModel: 'mock-default' },
]

export function getProviderPreset(kind: ProviderKind): ProviderPreset {
  return PROVIDER_PRESETS.find((preset) => preset.value === kind) ?? PROVIDER_PRESETS[0]
}
