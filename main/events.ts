import type { CovanEvent } from '../shared/types'

let send: (event: CovanEvent) => void = () => {}
export function setEventEmitter(emit: typeof send): void {
  send = emit
}
export function emitEvent(event: CovanEvent): void {
  try {
    send(event)
  } catch {
    /* A closing renderer does not interrupt work. */
  }
}
