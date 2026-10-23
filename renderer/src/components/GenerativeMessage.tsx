import { Component, createContext, memo, useContext, useMemo, useState, type ReactNode } from 'react'
import { createLibrary, Renderer, type ElementNode } from '@openuidev/react-lang'
import {
  Card, Text, Metric, Table, BarChart, LineChart, AreaChart, PieChart, RadarChart, RadialChart, ScatterChart,
  Callout, Tag, List, Separator, Stack, Tabs, TabItem, Accordion, AccordionItem, Steps, StepsItem,
  Choices, Form, splitUiMessage, validateUiSource, uiReplyText, UI_MAX_SOURCE,
} from '@shared/openui'
import { MarkdownContent } from './MarkdownContent'
import { ChevronRightIcon } from './icons'
import { LineChartView, PieChartView, RadarChartView, RadialChartView, ScatterChartView } from './GenerativeCharts'
import { AccordionView, CalloutView, ListView, SeparatorView, StackView, StepsView, TabsView, TagView } from './GenerativeBlocks'
import './generativeUi.css'

type RenderNode = (value: unknown) => ReactNode
type SeriesChartProps = { title: string; labels: string[]; values: number[] }
type StackProps = { children: ElementNode[]; direction?: 'column' | 'row'; gap?: 's' | 'm' | 'l' }
type ItemsProps = { items: ElementNode[] }
type CalloutProps = { variant: 'info' | 'success' | 'warning' | 'error'; title: string; text: string }
type TagProps = { text: string; tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' }
type ListProps = { items: string[]; ordered?: boolean }
type SeparatorProps = { label?: string }
type ScatterProps = { title: string; xLabel: string; yLabel: string; xs: number[]; ys: number[] }

const Interaction = createContext<{ disabled: boolean; reply?: (text: string) => void }>({ disabled: true })

function ChoiceButtons({ prompt, options }: { prompt: string; options: string[] }) {
  const { disabled, reply } = useContext(Interaction)
  return (
    <fieldset className="genui-choices" disabled={disabled}>
      <legend>{prompt}</legend>
      <div>
        {options.map((option, index) => (
          <button type="button" key={index} onClick={() => reply?.(uiReplyText(prompt, option))}>
            <span>{option}</span>
            <span className="genui-choice-arrow" aria-hidden="true">
              <ChevronRightIcon width={13} height={13} strokeWidth={2.2} />
            </span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function ReplyForm({ title, fields }: { title: string; fields: { label: string; placeholder: string }[] }) {
  const { disabled, reply } = useContext(Interaction)
  const [values, setValues] = useState<Record<string, string>>({})
  return <form className="genui-form" aria-label={title} onSubmit={(event) => {
    event.preventDefault()
    if (!disabled) reply?.(uiReplyText(title, fields.map((field) => ({ label: field.label, value: values[field.label]?.trim() || '未填写' }))))
  }}>
    <fieldset disabled={disabled}>
      <legend>{title}</legend>
      {fields.map((field) => <label key={field.label}><span>{field.label}</span><input
        type="text" maxLength={1000} autoComplete="off" placeholder={field.placeholder}
        value={values[field.label] ?? ''}
        onChange={(event) => setValues((current) => ({ ...current, [field.label]: event.target.value }))}
      /></label>)}
      <button type="submit">填入回复</button>
    </fieldset>
  </form>
}

const library = createLibrary({ root: 'Card', components: [
  { ...Card, component: ({ props, renderNode }) => <section className="genui-card"><h3>{props.title}</h3><div className="genui-card-content">{renderNode(props.children)}</div></section> },
  { ...Text, component: ({ props }) => <p className="genui-text">{props.text}</p> },
  { ...Metric, component: ({ props }) => <div className="genui-metric"><span>{props.label}</span><strong>{props.value}</strong>{props.detail && <small>{props.detail}</small>}</div> },
  { ...Callout, component: ({ props }: { props: CalloutProps }) => <CalloutView {...props} /> },
  { ...Tag, component: ({ props }: { props: TagProps }) => <TagView {...props} /> },
  { ...List, component: ({ props }: { props: ListProps }) => <ListView {...props} /> },
  { ...Separator, component: ({ props }: { props: SeparatorProps }) => <SeparatorView {...props} /> },
  { ...Table, component: ({ props }) => <div className="genui-table" tabIndex={0} aria-label="对比表格"><table><thead><tr>{props.columns.map((column: string, index: number) => <th key={index} scope="col">{column}</th>)}</tr></thead><tbody>{props.rows.map((row: string[], index: number) => <tr key={index}>{row.map((cell, i) => <td key={i}>{cell}</td>)}</tr>)}</tbody></table></div> },
  { ...BarChart, component: ({ props }) => {
    const max = Math.max(1, ...props.values)
    return <figure className="genui-chart"><figcaption>{props.title}</figcaption>{props.labels.map((label: string, index: number) => <div className="genui-bar-row" key={index}><span>{label}</span><div className="genui-bar-track"><i style={{ width: `${props.values[index] / max * 100}%` }} /></div><strong>{props.values[index]}</strong></div>)}</figure>
  } },
  { ...LineChart, component: ({ props }: { props: SeriesChartProps }) => <LineChartView {...props} /> },
  { ...AreaChart, component: ({ props }: { props: SeriesChartProps }) => <LineChartView {...props} area /> },
  { ...PieChart, component: ({ props }: { props: SeriesChartProps & { variant?: 'pie' | 'donut' } }) => <PieChartView {...props} /> },
  { ...RadarChart, component: ({ props }: { props: SeriesChartProps }) => <RadarChartView {...props} /> },
  { ...RadialChart, component: ({ props }: { props: SeriesChartProps }) => <RadialChartView {...props} /> },
  { ...ScatterChart, component: ({ props }: { props: ScatterProps }) => <ScatterChartView {...props} /> },
  { ...Steps, component: ({ props }: { props: ItemsProps }) => <StepsView items={props.items} /> },
  { ...StepsItem, component: () => null },
  { ...Stack, component: ({ props, renderNode }: { props: StackProps; renderNode: RenderNode }) => <StackView children={props.children} direction={props.direction} gap={props.gap} renderNode={renderNode} /> },
  { ...Tabs, component: ({ props, renderNode }: { props: ItemsProps; renderNode: RenderNode }) => <TabsView items={props.items} renderNode={renderNode} /> },
  { ...TabItem, component: () => null },
  { ...Accordion, component: ({ props, renderNode }: { props: ItemsProps; renderNode: RenderNode }) => <AccordionView items={props.items} renderNode={renderNode} /> },
  { ...AccordionItem, component: () => null },
  { ...Choices, component: ({ props }) => <ChoiceButtons prompt={props.prompt} options={props.options} /> },
  { ...Form, component: ({ props }) => <ReplyForm title={props.title} fields={props.fields} /> },
] })

function SourceFallback({ source, reason, pending }: { source: string; reason?: string; pending?: boolean }) {
  return <div className="genui-fallback" role="status">
    <p>{pending ? '正在生成交互界面…' : `暂时无法显示此界面${reason ? `：${reason}` : ''}`}</p>
    <details><summary>查看界面源码</summary><pre>{source.slice(0, UI_MAX_SOURCE)}{source.length > UI_MAX_SOURCE ? '\n…内容已截断，可复制原消息查看全文' : ''}</pre></details>
  </div>
}

class UiBoundary extends Component<{ source: string; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidUpdate(previous: { source: string }) {
    if (previous.source !== this.props.source && this.state.failed) this.setState({ failed: false })
  }
  render() { return this.state.failed ? <SourceFallback source={this.props.source} reason="渲染失败" /> : this.props.children }
}

function UiBlock({ source, pending, disabled, overLimit, onReply }: {
  source: string; pending: boolean; disabled: boolean; overLimit: boolean; onReply?: (text: string) => void
}) {
  const [notice, setNotice] = useState('')
  const validation = useMemo(() => {
    try {
      if (overLimit) throw new Error('每条消息最多展示3块交互界面')
      validateUiSource(source)
      return ''
    } catch (error) { return error instanceof Error ? error.message : '格式无效' }
  }, [source, overLimit])
  const context = useMemo(() => ({
    disabled: disabled || pending || !!validation || !onReply,
    reply: (text: string) => { onReply?.(text); setNotice('已填入输入框，确认后发送') },
  }), [disabled, pending, validation, onReply])
  if (validation) return <SourceFallback source={source} reason={validation} pending={pending && !overLimit && source.length <= UI_MAX_SOURCE} />
  return <div className="genui-block" aria-busy={pending}>
    <UiBoundary source={source}>
      <Interaction.Provider value={context}>
        <Renderer library={library} response={source} isStreaming={pending} publishObservability={false} />
      </Interaction.Provider>
    </UiBoundary>
    {notice && <p className="genui-notice" role="status">{notice}</p>}
  </div>
}

export const GenerativeMessage = memo(function GenerativeMessage({ content, streaming, interactive, onReply }: {
  content: string; streaming: boolean; interactive: boolean; onReply?: (text: string) => void
}) {
  const parts = useMemo(() => splitUiMessage(content), [content])
  return <>{parts.map((part, index) => part.kind === 'markdown'
    ? <MarkdownContent key={index} content={part.content} />
    : <UiBlock key={index} source={part.content} pending={streaming} disabled={!interactive || !part.closed} overLimit={part.overLimit} onReply={onReply} />)}</>
})
