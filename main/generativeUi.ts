import { generateSystemPrompt } from '@openuidev/lang-core'
import { uiSpec } from '../shared/openui'

// Keep user data out of third-party telemetry, including inherited opt-in flags.
process.env.OPENUI_TELEMETRY_DISABLED = '1'

const uiPrompt = generateSystemPrompt({
  library: uiSpec.toSpec(),
  promptOptions: {
    inlineMode: true, bindings: false, toolCalls: false, builtinFunctions: false,
    preamble: '你可以用 OpenUI 辅助当前对话，而不是每次都生成界面。',
    additionalRules: [
      '普通闲聊、代码解释、简短回答使用 Markdown。只有对比、数据展示、选择或收集信息更适合界面时才使用一个 ```openui-lang 围栏，可在围栏外保留简短 Markdown 说明。',
      '仅使用本组件库中的 Card、Text、Metric、Callout、Tag、List、Separator、Table、BarChart、LineChart、AreaChart、PieChart、RadarChart、RadialChart、ScatterChart、Steps、Stack、Tabs、TabItem、Accordion、AccordionItem、Choices、Form。每块必须从 root = Card(...) 开始；先定义根，其他组件单独赋值并引用。不得使用 Query/Mutation、$变量、@函数/动作、HTML、JavaScript、URL 或嵌套 Card。',
      '每条消息是独立界面，不维护或修改上一轮 dashboard。即使是在调整上一条界面，也输出完整 root = Card(...)，不要只输出变更语句。',
      '每条消息最多3块，每块不超过24000字符、120个节点、12层深度。表格最多50行、8列，柱状图最多50项，折线图/面积图最多24个点，饼图2–12项，雷达图3–10项，进度环1–8项（0–100），散点图2–100个点，Stack 子项最多16，Tabs/Accordion 最多8组，表单/选项最多8项。数据较多时先概括，不堆满界面。',
      '所有数字与结论基于用户提供的信息或本轮真实工具结果；注明来源和单位，缺失信息如实写“待确认”，不得为填满图表编造数据。',
      '交互只把选择或表单内容填入用户的回复草稿，等待用户发送，不代表已执行、已保存文件或已创建任务。所有表单字段都是普通文本，不收集密码、API Key 或其他密钥。',
      'Form fields 使用 {label: "标签", placeholder: "提示"}，标签不得重复；Table 行列数一致；BarChart 仅用非负数；LineChart 用于随时间变化的趋势，values 可为负，labels 与 values 等长且至少2个点。',
      '布局优先用 Stack 排列，需要切换视图用 Tabs，需要折叠分组用 Accordion；Tabs/Accordion 内不能再嵌套自身，每个 value 唯一。',
      '图表选择：BarChart 仅用于非负数比较，LineChart 看趋势，AreaChart 看量级/累计，PieChart 看构成，RadarChart 看多指标，RadialChart 看完成度（values 为 0–100 百分比），ScatterChart 看两个数值变量的关系；labels/values、xs/ys 必须等长。',
      'Callout 只用于真正的提示、警告或成功反馈，Tag 只放短标签，List 只放简单条目，Separator 只做分组；不要用它们堆满界面。',
    ],
    examples: [
      'root = Card("周末安排", [intro, options])\nintro = Text("先选一个方向，再一起细化。")\noptions = Choices("周末想做什么？", ["去徒步", "逛展览", "在家休息"])',
      'root = Card("本月开销", [total, trend])\ntotal = Metric("总支出", "¥3,240", "本月 1–20 日")\ntrend = LineChart("每日支出（元）", ["1日", "5日", "10日", "15日", "20日"], [180, 260, 210, 320, 150])',
      'root = Card("方案", [summary, tabs])\nsummary = Callout("info", "结论", "先看预算，再看行程。")\ntabs = Tabs([tab])\ntab = TabItem("budget", "预算", [PieChart("花费构成", ["交通", "餐饮"], [320, 480])])',
    ],
  },
})

export function appendGenerativeUiPrompt(prompt: string): string {
  return `${prompt}\n\n## 可选交互式回复\n${uiPrompt}`
}
