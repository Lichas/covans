import { useId, useState, type ReactNode } from 'react'
import type { ElementNode } from '@openuidev/react-lang'

type RenderNode = (value: unknown) => ReactNode
type TabItemProps = { value: string; trigger: string; content: ElementNode[] }
type AccordionItemProps = TabItemProps
type StepsItemProps = { title: string; detail?: string; status?: 'done' | 'current' | 'todo' }
type CalloutProps = { variant: 'info' | 'success' | 'warning' | 'error'; title: string; text: string }
type TagProps = { text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }
type ListProps = { items: string[]; ordered?: boolean }
type SeparatorProps = { label?: string }

export function StackView({ children, direction = 'column', gap = 'm', renderNode }: {
  children: ElementNode[]
  direction?: 'column' | 'row'
  gap?: 's' | 'm' | 'l'
  renderNode: RenderNode
}) {
  return <div className={`genui-stack genui-stack-${direction} genui-gap-${gap}`}>{renderNode(children)}</div>
}

export function TabsView({ items, renderNode }: { items: ElementNode[]; renderNode: RenderNode }) {
  const [active, setActive] = useState(0)
  const base = useId().replace(/:/g, '')
  const current = Math.min(active, Math.max(0, items.length - 1))
  return (
    <div className="genui-tabs">
      <div className="genui-tab-list" role="tablist" aria-label="内容分页">
        {items.map((item, index) => {
          const props = item.props as TabItemProps
          return (
            <button
              key={props.value}
              type="button"
              className="shape-rect"
              role="tab"
              id={`${base}-tab-${index}`}
              aria-selected={index === current}
              aria-controls={`${base}-panel-${index}`}
              onClick={() => setActive(index)}
            >
              {props.trigger}
            </button>
          )
        })}
      </div>
      {items.map((item, index) => {
        const props = item.props as TabItemProps
        return (
          <div
            key={props.value}
            id={`${base}-panel-${index}`}
            className="genui-tab-panel"
            role="tabpanel"
            aria-labelledby={`${base}-tab-${index}`}
            hidden={index !== current}
          >
            {renderNode(props.content)}
          </div>
        )
      })}
    </div>
  )
}

export function AccordionView({ items, renderNode }: { items: ElementNode[]; renderNode: RenderNode }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const base = useId().replace(/:/g, '')
  return (
    <div className="genui-accordion">
      {items.map((item, index) => {
        const props = item.props as AccordionItemProps
        const expanded = open[props.value] ?? index === 0
        return (
          <section className="genui-accordion-item" key={props.value}>
            <button
              type="button"
              className="genui-accordion-trigger shape-rect"
              aria-expanded={expanded}
              aria-controls={`${base}-section-${index}`}
              onClick={() => setOpen((current) => ({ ...current, [props.value]: !expanded }))}
            >
              <span>{props.trigger}</span>
              <span className="genui-accordion-chevron" aria-hidden="true">{expanded ? '−' : '+'}</span>
            </button>
            <div id={`${base}-section-${index}`} className="genui-accordion-panel" hidden={!expanded}>
              {renderNode(props.content)}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export function StepsView({ items }: { items: ElementNode[] }) {
  return (
    <ol className="genui-steps">
      {items.map((item, index) => {
        const props = item.props as StepsItemProps
        const status = props.status ?? 'todo'
        return (
          <li className={`genui-step is-${status}`} key={index}>
            <span className="genui-step-marker" aria-hidden="true">{status === 'done' ? '✓' : index + 1}</span>
            <div>
              <strong>{props.title}</strong>
              {props.detail && <p>{props.detail}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export function CalloutView({ variant, title, text }: CalloutProps) {
  return <aside className={`genui-callout genui-callout-${variant}`} role="note"><strong>{title}</strong><p>{text}</p></aside>
}

export function TagView({ text, tone = 'neutral' }: TagProps) {
  return <span className={`genui-tag genui-tag-${tone}`}>{text}</span>
}

export function ListView({ items, ordered = false }: ListProps) {
  const content = items.map((item, index) => <li key={index}>{item}</li>)
  return ordered ? <ol className="genui-list">{content}</ol> : <ul className="genui-list">{content}</ul>
}

export function SeparatorView({ label }: SeparatorProps) {
  return <div className="genui-separator" role="separator">{label && <span>{label}</span>}</div>
}
