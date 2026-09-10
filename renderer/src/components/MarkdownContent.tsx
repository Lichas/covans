import { memo, useRef, type ComponentProps } from 'react'
import ReactMarkdown, {
  defaultUrlTransform,
  type Components,
} from 'react-markdown'
import { ChatImage, safeImageUrl } from './ChatImage'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeHighlight from 'rehype-highlight'
import rehypeKatex from 'rehype-katex'
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
const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as NonNullable<
  ComponentProps<typeof ReactMarkdown>['remarkPlugins']
>
const rehypePlugins = [
  [rehypeKatex, { throwOnError: false, strict: false }],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
] as NonNullable<ComponentProps<typeof ReactMarkdown>['rehypePlugins']>

function normalizeMathBlocks(content: string) {
  return content
    .split(/(```[\s\S]*?```|~~~[\s\S]*?~~~)/g)
    .map((part, index) => {
      if (index % 2 === 1) return part
      return part
        .replace(
          /(^|\n)[ \t]*\$\$[ \t]*([^\n]*?)[ \t]*\$\$[ \t]*(?=\n|$)/g,
          '$1$$$$\n$2\n$$$$',
        )
        .replace(
          /(^|\n)[ \t]*\\\[[ \t]*([^\n]*?)[ \t]*\\\][ \t]*(?=\n|$)/g,
          '$1$$$$\n$2\n$$$$',
        )
    })
    .join('')
}

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
        {normalizeMathBlocks(content)}
      </ReactMarkdown>
    </div>
  )
})
