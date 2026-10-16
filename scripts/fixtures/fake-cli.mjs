#!/usr/bin/env node
// scripts/fixtures/fake-cli.mjs — 本地 CLI 后端的确定性替身（无网络、无订阅消耗）
//
// 用 COVAN_FAKE_CLI_DIALECT 选择方言：codex（默认）或 claude。
// 用 COVAN_FAKE_CLI_LOG 指定一个文件，每次调用追加一行 JSON，便于断言提示词与会话续接。
import fs from 'node:fs'
import path from 'node:path'

const dialect = process.env.COVAN_FAKE_CLI_DIALECT === 'claude' ? 'claude' : 'codex'
const args = process.argv.slice(2)
const SESSION_ID = '11111111-2222-3333-4444-555555555555'

function logCall(entry) {
  const file = process.env.COVAN_FAKE_CLI_LOG
  if (!file) return
  fs.appendFileSync(file, `${JSON.stringify(entry)}\n`)
}

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`)
}

if (args.includes('--version')) {
  process.stdout.write(
    dialect === 'claude' ? '1.2.3 (Claude Code)\n' : 'codex-cli 0.149.0\n',
  )
  process.exit(0)
}

// codex: exec [resume <id>] ... <prompt>；claude: -p <prompt> ...
const isResume =
  dialect === 'claude'
    ? args.includes('--resume')
    : args[0] === 'exec' && args[1] === 'resume'
const prompt =
  dialect === 'claude'
    ? (args[args.indexOf('-p') + 1] ?? '')
    : (args[args.length - 1] ?? '')
const sandboxIndex = args.indexOf('--sandbox')
const modeIndex = args.indexOf('--permission-mode')
logCall({
  dialect,
  isResume,
  prompt,
  sandbox: sandboxIndex >= 0 ? args[sandboxIndex + 1] : '',
  permissionMode: modeIndex >= 0 ? args[modeIndex + 1] : '',
  imageCount: args.filter((arg) => arg === '-i').length,
})

if (prompt.includes('FAIL_ME')) {
  if (dialect === 'claude') {
    emit({ type: 'system', subtype: 'init', session_id: SESSION_ID })
    emit({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '假 CLI 主动失败', session_id: SESSION_ID })
    process.exit(1)
  }
  emit({ type: 'thread.started', thread_id: SESSION_ID })
  emit({ type: 'turn.started' })
  emit({ type: 'error', message: '假 CLI 主动失败' })
  emit({ type: 'turn.failed', error: { message: '假 CLI 主动失败' } })
  process.exit(1)
}

// 真实写入一个工作区文件，用于验证 file_change → 交付文件卡片这条链路。
const artifact = 'cli-note.txt'
try {
  fs.writeFileSync(path.join(process.cwd(), artifact), `来自假 CLI 的产物\n`)
} catch {
  /* 工作区不可写时忽略，不影响正文断言 */
}

const reply = `假 CLI 回复（${isResume ? '续接' : '新会话'}）：${prompt.slice(-40)}`

if (dialect === 'claude') {
  emit({ type: 'system', subtype: 'init', session_id: SESSION_ID, model: 'fake-model' })
  emit({
    type: 'assistant',
    session_id: SESSION_ID,
    message: { role: 'assistant', content: [{ type: 'text', text: reply }] },
  })
  emit({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: reply,
    session_id: SESSION_ID,
    usage: { input_tokens: 11, output_tokens: 7 },
  })
} else {
  emit({ type: 'thread.started', thread_id: SESSION_ID })
  emit({ type: 'turn.started' })
  emit({
    type: 'item.completed',
    item: { id: 'item_0', type: 'agent_message', text: reply },
  })
  emit({
    type: 'item.completed',
    item: {
      id: 'item_1',
      type: 'file_change',
      changes: [{ path: path.join(process.cwd(), artifact) }],
    },
  })
  emit({ type: 'turn.completed', usage: { input_tokens: 11, output_tokens: 7 } })
}
process.exit(0)
