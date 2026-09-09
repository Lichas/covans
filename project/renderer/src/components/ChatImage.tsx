import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Dialog } from './Dialog'

export const attachmentUrl = (path: string) => `covan-image://local/${path}`
export function safeImageUrl(src: string): string {
  return /^(https?:\/\/|covan-image:\/\/local\/chat-images\/|data:image\/(png|jpeg|webp|gif);base64,)/i.test(
    src,
  )
    ? src
    : ''
}

export function ChatImage({
  src,
  alt = '图片',
}: {
  src: string
  alt?: string
}) {
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = safeImageUrl(src)
  if (!url || failed)
    return <span className="image-unavailable">图片不可用 · {alt}</span>
  return (
    <>
      <button
        type="button"
        className="chat-image"
        onClick={() => setOpen(true)}
        aria-label={`放大图片：${alt}`}
      >
        <img
          src={url}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      </button>
      {open &&
        createPortal(
          <Dialog
            open
            title={alt}
            width="w-[960px]"
            onClose={() => setOpen(false)}
          >
            <img
              className="image-lightbox"
              src={url}
              alt={alt}
              referrerPolicy="no-referrer"
            />
          </Dialog>,
          document.body,
        )}
    </>
  )
}
