export function runOpenUiRegression(ui, generated, assert) {
  const valid = 'root = Card("出行安排", [intro, choices, form])\nintro = Text("请选择")\nchoices = Choices("目的地", ["山里", "海边"])\nform = Form("出发信息", [{label: "日期", placeholder: "周六"}])'
  ui.validateUiSource(valid)
  assert(true, 'OpenUI 共享规格接受卡片、选项与表单')
  ui.validateUiSource('root = Card("趋势", [trend])\ntrend = LineChart("每日预算（元）", ["1日", "2日"], [12, 18])')
  assert(true, 'OpenUI 接受折线图')
  ui.validateUiSource('root = Card("趋势", [trend])\ntrend = LineChart("变化", ["周一", "周二"], [-2, 3])')
  assert(true, '折线图允许负值')
  {
    const labels = Array.from({ length: 24 }, (_, index) => `"${String(index).padStart(2, '0')}:00"`).join(',')
    const values = Array.from({ length: 24 }, (_, index) => `${20 + index}`).join(',')
    ui.validateUiSource([
      'root = Card("服务器监控", [tip, m, tabs, tbl, acc])',
      'tip = Callout("info", "数据说明", "以下为模拟数据")',
      'm = Stack([m1, m2, m3, m4], "row", "m")',
      'm1 = Metric("CPU 使用率", "48.2%", "24h 均值")',
      'm2 = Metric("内存使用率", "68.4%", "24h 均值")',
      'm3 = Metric("磁盘最高占用", "84%", "data 盘")',
      'm4 = Metric("服务健康度", "5/6", "redis-cache 降级")',
      'tabs = Tabs([t1, t2, t3])',
      't1 = TabItem("cpu", "CPU", [c1])',
      't2 = TabItem("mem", "内存", [c2])',
      't3 = TabItem("disk", "磁盘", [c3])',
      `c1 = LineChart("CPU 使用率（%, 近 24h）", [${labels}], [${values}])`,
      `c2 = LineChart("内存使用率（%, 近 24h）", [${labels}], [${values}])`,
      `c3 = LineChart("磁盘使用率（%, 近 24h）", [${labels}], [${values}])`,
      'tbl = Table(["服务", "状态", "今日重启"], [["api", "正常", "0"], ["worker", "正常", "0"], ["redis-cache", "降级", "2"], ["mysql", "正常", "0"]])',
      'acc = Accordion([a1, a2])',
      'a1 = AccordionItem("alerts", "告警", [alertText])',
      'a2 = AccordionItem("advice", "建议", [adviceText])',
      'alertText = Text("redis-cache 今日重启 2 次，需要关注连接池和内存。")',
      'adviceText = Text("建议先检查 Redis 连接数，再观察 30 分钟。")',
    ].join('\n'))
    assert(true, 'OpenUI 接受多标签页监控面板')
  }
  for (const [label, source] of [
    ['内容与步骤', [
      'root = Card("内容", [callout, tag, list, steps, sep, stack])',
      'callout = Callout("info", "提示", "这是一条提示")',
      'tag = Tag("标签", "accent")',
      'list = List(["一", "二"], true)',
      'steps = Steps([step])',
      'step = StepsItem("第一步", "详情", "done")',
      'sep = Separator("分组")',
      'stack = Stack([callout, tag], "row", "s")',
    ].join('\n')],
    ['标签页与折叠', [
      'root = Card("布局", [tabs, accordion])',
      'tabs = Tabs([tab])',
      'tab = TabItem("a", "标签页", [intro])',
      'accordion = Accordion([section])',
      'section = AccordionItem("a", "折叠", [intro])',
      'intro = Text("内容")',
    ].join('\n')],
    ['扩展图表', [
      'root = Card("图表", [area, pie, radar, radial, scatter])',
      'area = AreaChart("面积", ["一", "二"], [1, 2])',
      'pie = PieChart("构成", ["A", "B"], [3, 1], "donut")',
      'radar = RadarChart("能力", ["A", "B", "C"], [1, 2, 3])',
      'radial = RadialChart("完成度", ["A", "B"], [2, 1])',
      'scatter = ScatterChart("散点", "X", "Y", [1, 2], [3, 4])',
    ].join('\n')],
  ]) {
    ui.validateUiSource(source)
    assert(true, `OpenUI 接受${label}`)
  }
  const parts = ui.splitUiMessage(`前文\n\n\`\`\`openui-lang\n${valid}\n\`\`\`\n\n后文`)
  assert(parts.length === 3 && parts[1].kind === 'ui' && parts[1].closed, 'OpenUI Lang 与 Markdown 混排并标记完成边界')
  const legacy = ui.splitUiMessage(`\`\`\`openui\n${valid}\n\`\`\``)
  assert(legacy.length === 1 && legacy[0].kind === 'ui' && legacy[0].closed, '历史 openui 围栏继续可渲染')
  const mixed = ui.splitUiMessage(`\`\`\`openui-lang\n${valid}\n\`\`\`\n\`\`\`openui\n${valid}\n\`\`\``)
  assert(mixed.length === 2 && mixed.every((part) => part.kind === 'ui' && part.closed), '同一消息可混用新围栏与历史围栏')
  const nearMiss = ui.splitUiMessage(`\`\`\`openui-lang-extra\n${valid}\n\`\`\``)
  assert(nearMiss.length === 1 && nearMiss[0].kind === 'markdown', '相似语言标签不会误判为界面')
  const pending = ui.splitUiMessage(`\`\`\`openui-lang\n${valid}`)
  assert(pending.length === 1 && !pending[0].closed, 'OpenUI Lang 未闭合围栏保持未完成状态')
  const nested = ui.splitUiMessage(`\`\`\`\`text\n\`\`\`openui-lang\n${valid}\n\`\`\`\n\`\`\`\``)
  assert(nested.length === 1 && nested[0].kind === 'markdown', '普通代码块里的 openui-lang 示例不会被执行')
  const tooMany = ui.splitUiMessage(Array(4).fill(`\`\`\`openui-lang\n${valid}\n\`\`\`\n`).join(''))
  assert(tooMany.filter((part) => part.kind === 'ui' && part.overLimit).length === 1, '每条消息只启用前三块 UI')
  for (const [label, source] of [
    ['未知组件', 'root = Card("x", [evil])\nevil = Iframe("https://example.com")'],
    ['嵌套界面', 'root = Card("x", [inner])\ninner = Card("inner", [Text("hi")])'],
    ['循环引用', 'root = Card("x", [a])\na = b\nb = a'],
    ['查询不能连通工具', 'root = Card("x", [Text("hi")])\nsecret = Query("read_user_profile", {})'],
    ['动作不能执行', 'root = Card("x", [Text(@OpenUrl("file:///tmp/test"))])'],
    ['动态表达式', 'root = Card("x", [Text($secret)])\n$secret = "x"'],
    ['数值范围', 'root = Card("x", [BarChart("x", ["a"], [-1])])'],
    ['图表长度', 'root = Card("x", [BarChart("x", ["a"], [1,2])])'],
    ['表格列数', 'root = Card("x", [Table(["a"], [["1","2"]])])'],
    ['折线图长度', 'root = Card("x", [LineChart("x", ["a","b"], [1,2,3])])'],
    ['折线图点数不足', 'root = Card("x", [LineChart("x", ["a"], [1])])'],
    ['折线图点数过多', `root = Card("x", [LineChart("x", [${Array.from({ length: 25 }, (_, i) => `"${i}"`).join(',')}], [${Array.from({ length: 25 }, (_, i) => i).join(',')}])])`],
    ['Stack 空子项', 'root = Card("x", [stack])\nstack = Stack([], "row")'],
    ['Tabs 子项类型', 'root = Card("x", [tabs])\ntabs = Tabs([text])\ntext = Text("x")'],
    ['Pie 长度', 'root = Card("x", [pie])\npie = PieChart("x", ["a","b"], [1,2,3])'],
    ['Radar 轴数', 'root = Card("x", [radar])\nradar = RadarChart("x", ["a","b"], [1,2])'],
    ['Scatter 长度', 'root = Card("x", [scatter])\nscatter = ScatterChart("x", "X", "Y", [1,2], [1])'],
    ['Radial 范围', 'root = Card("x", [radial])\nradial = RadialChart("x", ["a"], [101])'],
    ['Steps 空列表', 'root = Card("x", [steps])\nsteps = Steps([])'],
    ['重复表单字段', 'root = Card("x", [Form("x", [{label:"a",placeholder:""},{label:"a",placeholder:""}])])'],
    ['超长输出', valid + ' '.repeat(ui.UI_MAX_SOURCE)],
    ['深层表达式', `root = Card("x", ${'['.repeat(30)}Text("x")${']'.repeat(30)})`],
    ['重复声明', valid + '\nroot = Card("new", [Text("x")])'],
  ]) {
    let rejected = false
    try { ui.validateUiSource(source) } catch { rejected = true }
    assert(rejected, `OpenUI 拒绝${label}`)
  }
  const prompt = generated.appendGenerativeUiPrompt('原来的人设')
  assert(prompt.startsWith('原来的人设') && prompt.includes('Choices(') && prompt.includes('Form(') && prompt.includes('LineChart(') && prompt.includes('Stack(') && prompt.includes('PieChart(') && prompt.includes('Tabs(') && prompt.includes('Callout('), '正式回复提示由同一组件规格生成，保留原人设并包含扩展组件')
  assert(prompt.includes('```openui-lang') && !prompt.includes('```openui ') && !prompt.includes('```openui\n'), '正式回复提示只要求 SDK 的 openui-lang 围栏')
  assert(prompt.includes('每条消息是独立界面') && prompt.includes('完整 root = Card(...)'), '正式回复提示要求完整独立的 Card，而不是 SDK 的增量补丁写法')
  assert(!prompt.includes('api.thesys.dev'), '正式回复提示不使用托管服务')
  assert(ui.uiReplyText('出发信息', [{label: '日期', value: '周六'}]) === '出发信息\n日期：周六', '表单结果转换为可读回复')
}
