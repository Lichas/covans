// shared/ipcChannels.ts — IPC 通道名常量（主/preload 共用）
export const CH = {
  importChatImage: 'images:import',
  getUserProfile: 'user:profile',
  saveUserProfile: 'user:saveProfile',
  listUserMemories: 'user:memories',
  saveUserMemory: 'user:saveMemory',
  deleteUserMemory: 'user:deleteMemory',
  listAgentThreads: 'agentChats:list',
  getAgentThread: 'agentChats:get',
  startAgentConversation: 'agentChats:start',
  stopAgentConversation: 'agentChats:stop',
  expandAvatarPrompt: 'bots:expandAvatarPrompt',
  listProviders: 'providers:list',
  saveProvider: 'providers:save',
  deleteProvider: 'providers:delete',
  listProviderModels: 'providers:listModels',
  testProvider: 'providers:test',

  listBots: 'bots:list',
  createBot: 'bots:create',
  updateBot: 'bots:update',
  deleteBot: 'bots:delete',
  pickAvatar: 'bots:pickAvatar',
  generateAvatar: 'bots:generateAvatar',

  listChats: 'chats:list',
  createDm: 'chats:createDm',
  createGroup: 'chats:createGroup',
  updateChat: 'chats:update',
  deleteChat: 'chats:delete',
  markRead: 'chats:markRead',
  exportChat: 'chats:export',
  writeClipboard: 'clipboard:write',

  listMessages: 'messages:list',
  sendUserMessage: 'messages:sendUser',
  stopChat: 'messages:stop',

  listMemories: 'memories:list',
  addMemory: 'memories:add',
  deleteMemory: 'memories:delete',

  listWorkspaceFiles: 'workspace:list',
  openWorkspace: 'workspace:open',
  readWorkspaceFile: 'workspace:read',

  getSetting: 'settings:get',
  setSetting: 'settings:set',

  event: 'covan:event', // main → renderer 推送通道
} as const
