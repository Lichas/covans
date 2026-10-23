import { z } from 'zod/v4'
import {
  autoClose, createLibrary, defineComponent, parseExpression, split, tokenize,
  type ASTNode, type ElementNode,
} from '@openuidev/lang-core'

const text = z.string().max(2000)
const short = z.string().min(1).max(120)
const CARD_CHILD_MIN = 1
const CARD_CHILD_MAX = 16
const UI_MAX_VISITS = 800
const UI_FENCE_LANGUAGES = new Set(['openui-lang', 'openui'])

// ── Content ────────────────────────────────────────────────────────────────
export const Text = defineComponent({ name: 'Text', description: '一段简短说明，纯文本。', props: z.object({ text }), component: null })
export const Metric = defineComponent({ name: 'Metric', description: '一个指标及其数值，detail 写来源或补充说明。', props: z.object({ label: short, value: short, detail: text }), component: null })
export const Callout = defineComponent({ name: 'Callout', description: '强调提示，variant 为 info/success/warning/error。', props: z.object({ variant: z.enum(['info', 'success', 'warning', 'error']), title: short, text }), component: null })
export const Tag = defineComponent({ name: 'Tag', description: '短标签，tone 为 neutral/accent/success/warning/danger。', props: z.object({ text: short, tone: z.enum(['neutral', 'accent', 'success', 'warning', 'danger']).optional() }), component: null })
export const List = defineComponent({ name: 'List', description: '简单无序或有序列表，items 为文本数组。', props: z.object({ items: z.array(text).min(1).max(12), ordered: z.boolean().optional() }), component: null })
export const Separator = defineComponent({ name: 'Separator', description: '分隔线，可带一个短标签。', props: z.object({ label: short.optional() }), component: null })

// ── Tables & charts ───────────────────────────────────────────────────────
export const Table = defineComponent({ name: 'Table', description: '方案或数据对比表，每行单元格数量须与 columns 相同。', props: z.object({ columns: z.array(short).min(1).max(8), rows: z.array(z.array(text).max(8)).max(50) }), component: null })
export const BarChart = defineComponent({ name: 'BarChart', description: '水平柱状图，仅用于非负数比较。labels 与 values 长度须相同，标题注明单位。', props: z.object({ title: short, labels: z.array(short).min(1).max(50), values: z.array(z.number().finite().nonnegative()).min(1).max(50) }), component: null })
export const LineChart = defineComponent({ name: 'LineChart', description: '单序列折线图，用于随时间变化的趋势。labels 与 values 长度须相同，至少2个、最多24个点；标题注明单位和时间范围。', props: z.object({ title: short, labels: z.array(short).min(2).max(24), values: z.array(z.number().finite()).min(2).max(24) }), component: null })
export const AreaChart = defineComponent({ name: 'AreaChart', description: '单序列面积图，用于强调随时间变化的量级或累计值。labels 与 values 长度须相同，至少2个、最多24个点。', props: z.object({ title: short, labels: z.array(short).min(2).max(24), values: z.array(z.number().finite()).min(2).max(24) }), component: null })
export const PieChart = defineComponent({ name: 'PieChart', description: '构成占比图，variant 为 pie/donut。labels 与 values 长度须相同，2–12项，数值非负。', props: z.object({ title: short, labels: z.array(short).min(2).max(12), values: z.array(z.number().finite().nonnegative()).min(2).max(12), variant: z.enum(['pie', 'donut']).optional() }), component: null })
export const RadarChart = defineComponent({ name: 'RadarChart', description: '多指标雷达图，labels 与 values 长度须相同，3–10项，数值非负。', props: z.object({ title: short, labels: z.array(short).min(3).max(10), values: z.array(z.number().finite().nonnegative()).min(3).max(10) }), component: null })
export const RadialChart = defineComponent({ name: 'RadialChart', description: '完成度/进度环，labels 与 values 长度须相同，1–8项，values 为 0–100 的百分比。', props: z.object({ title: short, labels: z.array(short).min(1).max(8), values: z.array(z.number().finite().min(0).max(100)).min(1).max(8) }), component: null })
export const ScatterChart = defineComponent({ name: 'ScatterChart', description: '双变量散点图，xs 与 ys 长度须相同，2–100个点；xLabel/yLabel 写轴含义。', props: z.object({ title: short, xLabel: short, yLabel: short, xs: z.array(z.number().finite()).min(2).max(100), ys: z.array(z.number().finite()).min(2).max(100) }), component: null })

// ── Steps (a display container with item nodes) ──────────────────────────
export const StepsItem = defineComponent({ name: 'StepsItem', description: '一个步骤，status 为 done/current/todo。', props: z.object({ title: short, detail: text.optional(), status: z.enum(['done', 'current', 'todo']).optional() }), component: null })
export const Steps = defineComponent({ name: 'Steps', description: '步骤列表，items 为 StepsItem 引用。', props: z.object({ items: z.array(StepsItem.ref).min(1).max(8) }), component: null })

// ── Interaction (draft only) ─────────────────────────────────────────────
export const Choices = defineComponent({ name: 'Choices', description: '让用户选择一项，每项点击后填入回复草稿。', props: z.object({ prompt: short, options: z.array(short).min(1).max(8) }), component: null })
export const Form = defineComponent({ name: 'Form', description: '收集最多8项文字信息，fields 使用 {label, placeholder} 对象，label 不重复。提交仅填入回复草稿。', props: z.object({ title: short, fields: z.array(z.object({ label: short, placeholder: z.string().max(200) })).min(1).max(8) }), component: null })

const leafUnion = z.union([
  Text.ref, Metric.ref, Callout.ref, Tag.ref, List.ref, Separator.ref,
  Table.ref, BarChart.ref, LineChart.ref, AreaChart.ref, PieChart.ref,
  RadarChart.ref, RadialChart.ref, ScatterChart.ref, Steps.ref,
  Choices.ref, Form.ref,
])

// ── Layout containers ─────────────────────────────────────────────────────
export const Stack = defineComponent({
  name: 'Stack',
  description: '排列容器，children 为组件引用数组；direction 为 column/row，gap 为 s/m/l。',
  props: z.object({
    children: z.array(leafUnion).min(1).max(16),
    direction: z.enum(['column', 'row']).optional(),
    gap: z.enum(['s', 'm', 'l']).optional(),
  }),
  component: null,
})

const tabContentUnion = z.union([
  Text.ref, Metric.ref, Callout.ref, Tag.ref, List.ref, Separator.ref,
  Table.ref, BarChart.ref, LineChart.ref, AreaChart.ref, PieChart.ref,
  RadarChart.ref, RadialChart.ref, ScatterChart.ref, Steps.ref,
  Choices.ref, Form.ref, Stack.ref,
])

export const TabItem = defineComponent({
  name: 'TabItem',
  description: '一个标签页，value 是唯一 id，trigger 是标签，content 是内容组件引用数组。',
  props: z.object({ value: short, trigger: short, content: z.array(tabContentUnion).min(1).max(16) }),
  component: null,
})
export const Tabs = defineComponent({
  name: 'Tabs',
  description: '标签页容器，items 为 TabItem 引用。',
  props: z.object({ items: z.array(TabItem.ref).min(1).max(8) }),
  component: null,
})

export const AccordionItem = defineComponent({
  name: 'AccordionItem',
  description: '一个折叠区块，value 是唯一 id，trigger 是标题，content 是内容组件引用数组。',
  props: z.object({ value: short, trigger: short, content: z.array(tabContentUnion).min(1).max(16) }),
  component: null,
})
export const Accordion = defineComponent({
  name: 'Accordion',
  description: '折叠区块容器，items 为 AccordionItem 引用。',
  props: z.object({ items: z.array(AccordionItem.ref).min(1).max(8) }),
  component: null,
})

// ── Root ──────────────────────────────────────────────────────────────────
export const Card = defineComponent({
  name: 'Card',
  description: '界面根卡片，title 是标题，children 是独立组件引用数组。',
  props: z.object({
    title: short,
    children: z.array(z.union([
      Text.ref, Metric.ref, Callout.ref, Tag.ref, List.ref, Separator.ref,
      Table.ref, BarChart.ref, LineChart.ref, AreaChart.ref, PieChart.ref,
      RadarChart.ref, RadialChart.ref, ScatterChart.ref, Steps.ref,
      Choices.ref, Form.ref, Stack.ref, Tabs.ref, Accordion.ref,
    ])).min(CARD_CHILD_MIN).max(CARD_CHILD_MAX),
  }),
  component: null,
})

export const uiDefinitions = [
  Card,
  Text, Metric, Callout, Tag, List, Separator,
  Table, BarChart, LineChart, AreaChart, PieChart, RadarChart, RadialChart, ScatterChart,
  StepsItem, Steps,
  Stack, TabItem, Tabs, AccordionItem, Accordion,
  Choices, Form,
]

const leafNames = new Set([
  'Text', 'Metric', 'Callout', 'Tag', 'List', 'Separator',
  'Table', 'BarChart', 'LineChart', 'AreaChart', 'PieChart',
  'RadarChart', 'RadialChart', 'ScatterChart', 'Steps', 'Choices', 'Form',
])
const stackChildNames = new Set(leafNames)
const tabContentNames = new Set([...leafNames, 'Stack'])
const cardChildNames = new Set([...leafNames, 'Stack', 'Tabs', 'Accordion'])
const tabItemNames = new Set(['TabItem'])
const accordionItemNames = new Set(['AccordionItem'])
const stepItemNames = new Set(['StepsItem'])

export const uiSpec = createLibrary({
  root: 'Card',
  components: uiDefinitions,
  componentGroups: [
    {
      name: 'Content',
      components: ['Card', 'Text', 'Metric', 'Callout', 'Tag', 'List', 'Separator'],
      notes: [
        'Card 是根容器；Text 是纯文本，长文/代码优先用 Markdown。',
        'Callout 只用于真正的提示、警告或成功反馈，不要每条回复都用。',
      ],
    },
    {
      name: 'Layout',
      components: ['Stack', 'Tabs', 'TabItem', 'Accordion', 'AccordionItem', 'Steps', 'StepsItem'],
      notes: [
        'Stack 只负责排列，不要嵌套 Card；direction="row" 时内容会自动换行。',
        'Tabs 和 Accordion 的内容不能再嵌套它们自身；每个 TabItem/AccordionItem 都需要唯一 value。',
      ],
    },
    {
      name: 'Charts',
      components: ['BarChart', 'LineChart', 'AreaChart', 'PieChart', 'RadarChart', 'RadialChart', 'ScatterChart'],
      notes: [
        'BarChart 用于非负数比较；LineChart 用于趋势；AreaChart 用于量级/累计；PieChart 用于构成；RadarChart 用于多指标；RadialChart 用于完成度；ScatterChart 用于两个数值变量的关系。',
        '图表标题必须注明单位和时间范围；数值必须来自用户信息或本轮真实工具结果。',
      ],
    },
    {
      name: 'Tables',
      components: ['Table'],
    },
    {
      name: 'Interaction',
      components: ['Choices', 'Form'],
      notes: [
        '选项和表单只把内容填入用户的回复草稿，等待用户发送；不代表已执行、已保存或已创建任务。',
        '所有表单字段都是普通文本，不收集密码、API Key 或其他密钥。',
      ],
    },
  ],
})
export const UI_MAX_SOURCE = 24_000
export type UiMessagePart = { kind: 'markdown'; content: string } | { kind: 'ui'; content: string; closed: boolean; overLimit: boolean }

/** Canonical fences use `openui-lang`; legacy `openui` stays accepted for saved messages. */
export function splitUiMessage(content: string): UiMessagePart[] {
  const parts: UiMessagePart[] = []
  let markdown = '', source = '', fence = '', ui = false, count = 0
  for (const line of content.split(/(?<=\n)/)) {
    const opening = line.match(/^ {0,3}(`{3,}|~{3,})([^\r\n]*)\r?\n?$/)
    if (!fence) {
      if (opening) {
        fence = opening[1]
        ui = UI_FENCE_LANGUAGES.has(opening[2].trim().toLowerCase())
        if (ui) {
          if (markdown) parts.push({ kind: 'markdown', content: markdown })
          markdown = ''; source = ''; count++
        } else markdown += line
      } else markdown += line
    } else if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}[ \\t]*\\r?\\n?$`).test(line)) {
      if (ui) parts.push({ kind: 'ui', content: source, closed: true, overLimit: count > 3 })
      else markdown += line
      fence = ''; ui = false
    } else if (ui) source += line
    else markdown += line
  }
  if (ui) parts.push({ kind: 'ui', content: source, closed: false, overLimit: count > 3 })
  if (markdown) parts.push({ kind: 'markdown', content: markdown })
  return parts
}

function isElementNode(value: unknown): value is ElementNode {
  if (!value || typeof value !== 'object') return false
  const node = value as ElementNode
  return node.type === 'element' && typeof node.typeName === 'string' && node.partial === false && !!node.props && typeof node.props === 'object'
}

/** Convert a rendered element tree back into plain prop objects for Zod validation. */
function normalizeForSchema(value: unknown): unknown {
  if (!isElementNode(value)) return value
  const props = value.props as Record<string, unknown>
  const children = (key: string) => {
    const list = props[key]
    return Array.isArray(list) ? list.map(normalizeForSchema) : list
  }
  if (value.typeName === 'Card' || value.typeName === 'Stack') {
    return { ...props, children: children('children') }
  }
  if (value.typeName === 'Tabs' || value.typeName === 'Accordion' || value.typeName === 'Steps') {
    return { ...props, items: children('items') }
  }
  if (value.typeName === 'TabItem' || value.typeName === 'AccordionItem') {
    return { ...props, content: children('content') }
  }
  return props
}

function validateContainer(definition: { props: z.ZodObject }, props: Record<string, unknown>, key: 'children' | 'items', allowed: Set<string>): boolean {
  const value = props[key]
  if (!Array.isArray(value) || !value.every((child) => isElementNode(child) && allowed.has(child.typeName))) return false
  return definition.props.safeParse({ ...props, [key]: value.map(normalizeForSchema) }).success
}

function validateComponentProps(definition: (typeof uiDefinitions)[number], props: Record<string, unknown>): boolean {
  switch (definition.name) {
    case 'Card':
      return validateContainer(definition as { props: z.ZodObject }, props, 'children', cardChildNames)
    case 'Stack':
      return validateContainer(definition as { props: z.ZodObject }, props, 'children', stackChildNames)
    case 'Tabs':
      return validateContainer(definition as { props: z.ZodObject }, props, 'items', tabItemNames)
    case 'Accordion':
      return validateContainer(definition as { props: z.ZodObject }, props, 'items', accordionItemNames)
    case 'Steps':
      return validateContainer(definition as { props: z.ZodObject }, props, 'items', stepItemNames)
    case 'TabItem':
    case 'AccordionItem': {
      const content = props.content
      return Array.isArray(content) && content.every((child) => isElementNode(child) && tabContentNames.has(child.typeName)) &&
        definition.props.safeParse({ ...props, content: content.map(normalizeForSchema) }).success
    }
    default:
      return definition.props.safeParse(props).success
  }
}

/** Bound and validate the static DSL BEFORE passing it to the upstream renderer. */
export function validateUiSource(source: string): void {
  if (source.length > UI_MAX_SOURCE) throw new Error('界面内容超过大小限制')
  const { text: closed } = autoClose(source)
  let depth = 0
  for (const char of closed.replace(/"(?:\\.|[^"\\])*"/g, '""')) {
    if ('([{'.includes(char) && ++depth > 12) throw new Error('界面嵌套过深')
    if (')]}'.includes(char)) depth--
  }
  const statements = split(tokenize(closed))
  if (!statements.length || statements.length > 120) throw new Error('界面结构尚未完成或超过限制')
  const nodes = new Map<string, ASTNode>()
  for (const statement of statements) {
    if (!/^[A-Za-z_][A-Za-z_0-9]*$/.test(statement.id) || nodes.has(statement.id)) throw new Error('界面变量无效或重复')
    nodes.set(statement.id, parseExpression(statement.tokens))
  }
  let visits = 0
  const evaluate = (node: ASTNode, path: Set<string>, level: number): unknown => {
    if (++visits > UI_MAX_VISITS || level > 12) throw new Error('界面结构超过限制')
    switch (node.k) {
      case 'Str': case 'Bool': return node.v
      case 'Num': if (!Number.isFinite(node.v)) throw new Error('数值无效'); return node.v
      case 'Null': return null
      case 'Arr': return node.els.map((item) => evaluate(item, path, level + 1))
      case 'Obj': {
        if (node.entries.some(([key]) => !['label', 'placeholder'].includes(key))) throw new Error('界面字段不受支持')
        return Object.fromEntries(node.entries.map(([key, value]) => [key, evaluate(value, path, level + 1)]))
      }
      case 'Ref': {
        const ref = nodes.get(node.n)
        if (!ref || path.has(node.n)) throw new Error('界面引用未完成或存在循环')
        return evaluate(ref, new Set([...path, node.n]), level + 1)
      }
      case 'Comp': {
        const definition = uiDefinitions.find((item) => item.name === node.name)
        if (!definition || node.fn) throw new Error('界面组件或动作不受支持')
        const keys = Object.keys(definition.props.shape)
        if (node.args.length > keys.length) throw new Error('界面参数过多')
        const props: Record<string, unknown> = {}
        for (let index = 0; index < node.args.length; index++) {
          props[keys[index]] = evaluate(node.args[index], path, level + 1)
        }
        if (!validateComponentProps(definition, props)) throw new Error('界面字段格式无效或超过限制')
        if (node.name === 'Table' && (props.rows as string[][]).some((row) => row.length !== (props.columns as string[]).length)) throw new Error('表格列数不一致')
        if ((node.name === 'BarChart' || node.name === 'LineChart' || node.name === 'AreaChart' || node.name === 'PieChart' || node.name === 'RadarChart' || node.name === 'RadialChart') && (props.labels as string[]).length !== (props.values as number[]).length) throw new Error('图表数据不完整')
        if (node.name === 'ScatterChart' && (props.xs as number[]).length !== (props.ys as number[]).length) throw new Error('散点图数据不完整')
        if (node.name === 'Form' && new Set((props.fields as { label: string }[]).map((field) => field.label)).size !== (props.fields as unknown[]).length) throw new Error('表单字段重复')
        return { type: 'element', typeName: node.name, props, partial: false } satisfies ElementNode
      }
      default: throw new Error('此界面表达式不受支持')
    }
  }
  const root = nodes.get('root')
  if (!root || root.k !== 'Comp' || root.name !== 'Card') throw new Error('界面需要 Card 根组件')
  evaluate(root, new Set(['root']), 0)
  // Unused declarations must not hide queries, actions or invalid components.
  for (const [id, node] of nodes) {
    visits = 0
    evaluate(node, new Set([id]), 0)
  }
}

export function uiReplyText(title: string, values: string | { label: string; value: string }[]): string {
  return `${title}\n${typeof values === 'string' ? values : values.map((field) => `${field.label}：${field.value}`).join('\n')}`
}
