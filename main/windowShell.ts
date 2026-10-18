// main/windowShell.ts — 主窗口外壳（原生材质）与透明度设置
//
// 透明度只能改原生 vibrancy 材质，渲染层无法伪造玻璃效果，因此由主进程持有
// 窗口引用并在设置变化时应用。只有 macOS 有原生材质；其它平台是空操作。
import type { BrowserWindow } from 'electron'

let shellWindow: BrowserWindow | null = null

/** 记录主窗口，供设置变更时调用（窗口销毁后自动失效）。 */
export function setShellWindow(win: BrowserWindow | null): void {
  shellWindow = win
}

/**
 * 标准/更透都使用 sidebar 材质，两者差别在渲染层是否再叠一层自绘淡色；
 * 最透换成更透明的 under-window 材质。
 */
export function applyWindowTransparency(level: string): void {
  if (process.platform !== 'darwin') return
  if (!shellWindow || shellWindow.isDestroyed()) return
  shellWindow.setVibrancy(level === 'ultra' ? 'under-window' : 'sidebar')
}

export function initialVibrancy(level: string): 'sidebar' | 'under-window' {
  return level === 'ultra' ? 'under-window' : 'sidebar'
}
