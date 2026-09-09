import { memo, useRef, type ComponentProps } from 'react'
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown'
import { ChatImage, safeImageUrl } from './ChatImage'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { CopyButton } from './CopyButton'

function CodeBlock({ children, ...props }: ComponentProps<'pre'>) {
  const ref = useRef<HTMLPreElement>(null)
  const language =
    (
      children as React.ReactElement<{ className?: string }>
    )?.props?.className?.match(/language-([^\s]+)/)?.[1] ?? 'text'
  return (
    <div className="code-block">
      <div className="code-toolbar">
        <span>{language}</span>
        <CopyButton
          label="复制代码"
          text={() => ref.current?.textContent?.replace(/\n$/, '') ?? ''}
        />
      </div>
      <pre ref={ref} {...props}>
        {children}
      </pre>
    </div>
  )
}

const components: Components = {
  pre: ({ node: _node, ...props }) => <CodeBlock {...props} />,
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  ),
  table: ({ node: _node, ...props }) => (
    <div className="table-scroll scroll-thin">
      <table {...props} />
    </div>
  ),
  img: ({ src, alt }) => <ChatImage src={src || ''} alt={alt || '图片'} />,
}
const remarkPlugins = [remarkGfm]
const rehypePlugins = [
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
] as NonNullable<ComponentProps<typeof ReactMarkdown>['rehypePlugins']>

export const MarkdownContent = memo(function MarkdownContent({
  content,
}: {
  content: string
}) {
  return (
    <div className="markdown-content selectable">
      <ReactMarkdown
        urlTransform={(url, key, node) =>
          node.tagName === 'img' && key === 'src'
            ? safeImageUrl(url)
            : defaultUrlTransform(url)
        }
        remarkPlugins={remarkPlugins}
        rehypePlugins={rehypePlugins}
        components={components}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
