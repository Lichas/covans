import { useEffect, useRef, useState } from 'react'
import type { PrintResult } from '@shared/types'

export function useDocumentPrinting(context: string) {
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [failed, setFailed] = useState(false)
  const running = useRef(false)
  const current = useRef(context)
  current.current = context
  useEffect(() => { setMessage(''); setFailed(false) }, [context])

  const print = async (action: () => Promise<PrintResult>) => {
    if (running.current) return
    running.current = true
    const source = context
    setBusy(true)
    setMessage('正在准备系统打印对话框…')
    setFailed(false)
    try {
      const result = await action()
      if (current.current !== source) return
      setFailed(result.status === 'failed')
      setMessage(result.status === 'failed' ? result.error
        : result.status === 'cancelled' ? '已取消打印' : '已提交系统打印队列')
    } catch {
      if (current.current === source) {
        setFailed(true)
        setMessage('无法启动打印，请检查文件后重试')
      }
    } finally { running.current = false; setBusy(false) }
  }
  return { busy, message, failed, print }
}
