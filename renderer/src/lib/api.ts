// lib/api.ts — window.covan 的类型化封装
import type { CovanApi } from '@shared/types'

/**
 * preload 通过 contextBridge 暴露 window.covan（shared/types.ts 已全局声明）。
 * 这里再做一层封装，便于渲染层统一引用与后续加兜底逻辑。
 */
function resolveApi(): CovanApi {
  if (typeof window !== 'undefined' && window.covan) return window.covan
  // 开发环境（纯浏览器预览）下没有 preload，给一个全空实现的兜底，避免白屏崩溃。
  const noopAsync = async () => {
    throw new Error('window.covan 不可用：请在 Electron 环境中运行')
  }
  const stub = new Proxy({} as CovanApi, {
    get(_t, prop) {
      if (prop === 'onEvent') return () => () => undefined
      return noopAsync
    },
  })
  return stub
}

export const api: CovanApi = resolveApi()
