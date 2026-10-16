import { dialog, ipcMain } from 'electron'
import { CH } from '../../shared/ipcChannels'
import type { BotExtensions, McpServerInput } from '../../shared/types'
import {
  deleteMcpServer,
  getBotExtensions,
  listMcpServers,
  listSkills,
  saveMcpServer,
  setBotExtensions,
  setSkillEnabled,
} from './store'
import { testMcpServer } from './mcp'
import { deleteSkill, installSkills, readSkillFile } from './skills'

export function registerExtensionIpc(): void {
  ipcMain.handle(CH.listExtensions, () => ({
    servers: listMcpServers(),
    skills: listSkills(),
  }))
  ipcMain.handle(CH.saveMcpServer, (_e, input: McpServerInput) =>
    saveMcpServer(input),
  )
  ipcMain.handle(CH.deleteMcpServer, (_e, id: string) => deleteMcpServer(id))
  ipcMain.handle(CH.testMcpServer, (_e, id: string) => testMcpServer(id))
  ipcMain.handle(CH.pickSkillDirectory, async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Skill 目录',
      properties: ['openDirectory'],
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(
    CH.installSkills,
    (_e, source: string, subdirectory?: string) =>
      installSkills(source, subdirectory),
  )
  ipcMain.handle(CH.readInstalledSkill, async (_e, id: string) => {
    const { content, files } = await readSkillFile(id)
    return { content, files }
  })
  ipcMain.handle(CH.setSkillEnabled, (_e, id: string, enabled: boolean) =>
    setSkillEnabled(id, enabled),
  )
  ipcMain.handle(CH.deleteSkill, (_e, id: string) => deleteSkill(id))
  ipcMain.handle(CH.getBotExtensions, (_e, botId: string) =>
    getBotExtensions(botId),
  )
  ipcMain.handle(
    CH.setBotExtensions,
    (_e, botId: string, config: BotExtensions) =>
      setBotExtensions(botId, config),
  )
}
