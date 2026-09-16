// stores/scheduledTasksStore.ts — 定时 Agent 任务的全局缓存
import { create } from 'zustand'
import type { ScheduledTask, ScheduledTaskInput } from '@shared/types'
import { api } from '../lib/api'

interface ScheduledTasksState {
  tasks: ScheduledTask[]
  loadTasks: (botId?: string) => Promise<void>
  saveTask: (input: ScheduledTaskInput) => Promise<ScheduledTask>
  deleteTask: (id: string) => Promise<void>
  runTask: (id: string) => Promise<void>
}

export const useScheduledTasksStore = create<ScheduledTasksState>((set) => ({
  tasks: [],
  loadTasks: async (botId) => {
    const tasks = await api.listScheduledTasks(botId)
    // 始终保留完整列表，Bot 侧面板在渲染时过滤，避免事件刷新时丢失全局数据。
    if (botId) {
      set((state) => ({
        tasks: [
          ...state.tasks.filter((task) => task.bot_id !== botId),
          ...tasks,
        ],
      }))
      return
    }
    set({ tasks })
  },
  saveTask: async (input) => {
    const task = await api.saveScheduledTask(input)
    set((state) => ({
      tasks: [...state.tasks.filter((item) => item.id !== task.id), task],
    }))
    return task
  },
  deleteTask: async (id) => {
    await api.deleteScheduledTask(id)
    set((state) => ({ tasks: state.tasks.filter((task) => task.id !== id) }))
  },
  runTask: async (id) => {
    await api.runScheduledTask(id)
    await useScheduledTasksStore.getState().loadTasks()
  },
}))
