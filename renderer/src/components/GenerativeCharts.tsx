import type { ReactNode } from 'react'

const compactNumber = new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 })
const fullNumber = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })
const chartColors = [
  'var(--genui-chart-1)',
  'var(--genui-chart-2)',
  'var(--genui-chart-3)',
  'var(--genui-chart-4)',
  'var(--genui-chart-5)',
  'var(--genui-chart-6)',
]

export type SeriesChartProps = { title: string; labels: string[]; values: number[] }

export function LineChartView({ title, labels, values, area = false }: SeriesChartProps & { area?: boolean }) {
  const width = 320
  const height = 120
  const left = 34
  const right = 8
  const top = 12
  const bottom = 12
  const min = Math.min(...values)
  const max = Math.max(...values)
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const points = values.map((value, index) => ({
    x: left + (plotWidth * index) / Math.max(1, values.length - 1),
    y: min === max ? top + plotHeight / 2 : top + ((max - value) / (max - min)) * plotHeight,
    value,
    label: labels[index],
  }))
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')
  const polygon = `${left},${top + plotHeight} ${polyline} ${left + plotWidth},${top + plotHeight}`
  const step = Math.max(1, Math.ceil(labels.length / 6))
  const ticks = labels.map((_, index) => index).filter((index) => index === 0 || index === labels.length - 1 || index % step === 0)
  return (
    <figure className={`genui-line-chart${area ? ' is-area' : ''}`} aria-label={title}>
      <figcaption><span>{title}</span><span className="genui-line-meta">最低 {fullNumber.format(min)} · 最高 {fullNumber.format(max)}</span></figcaption>
      <svg className="genui-line-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，${labels[0]} 到 ${labels[labels.length - 1]} 的趋势`}>
        {[0, 1, 2].map((line) => {
          const y = top + (plotHeight * line) / 2
          return <line key={line} className="genui-line-grid" x1={left} x2={left + plotWidth} y1={y} y2={y} />
        })}
        <text className="genui-line-axis" x={left - 6} y={top + 3} textAnchor="end">{compactNumber.format(max)}</text>
        <text className="genui-line-axis" x={left - 6} y={top + plotHeight + 3} textAnchor="end">{compactNumber.format(min)}</text>
        {area && <polygon className="genui-line-area" points={polygon} />}
        <polyline className="genui-line-stroke" points={polyline} />
        {points.map((point, index) => <circle key={index} className="genui-line-point" cx={point.x} cy={point.y} r={3}><title>{`${point.label}：${point.value}`}</title></circle>)}
      </svg>
      <div className="genui-line-labels">
        {ticks.map((index) => <span key={index}>{labels[index]}</span>)}
      </div>
    </figure>
  )
}

export function PieChartView({ title, labels, values, variant = 'pie' }: SeriesChartProps & { variant?: 'pie' | 'donut' }) {
  const total = values.reduce((sum, value) => sum + value, 0)
  let start = 0
  const stops = values.map((value, index) => {
    const end = total > 0 ? start + (value / total) * 100 : 0
    const stop = `${chartColors[index % chartColors.length]} ${start}% ${end}%`
    start = end
    return stop
  })
  const background = total > 0 ? `conic-gradient(${stops.join(', ')})` : 'var(--line)'
  return (
    <figure className="genui-pie-chart" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="genui-pie-body">
        <div className={`genui-pie${variant === 'donut' ? ' is-donut' : ''}`} style={{ background }} aria-hidden="true" />
        <ul className="genui-pie-legend">
          {labels.map((label, index) => (
            <li key={index}>
              <i style={{ background: chartColors[index % chartColors.length] }} aria-hidden="true" />
              <span>{label}</span>
              <strong>
                {fullNumber.format(values[index])}
                {total > 0 && <small>{Math.round((values[index] / total) * 100)}%</small>}
              </strong>
            </li>
          ))}
        </ul>
      </div>
    </figure>
  )
}

export function RadarChartView({ title, labels, values }: SeriesChartProps) {
  const size = 240
  const center = 120
  const radius = 78
  const max = Math.max(1, ...values)
  const point = (index: number, ratio: number): readonly [number, number] => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / labels.length
    return [center + Math.cos(angle) * radius * ratio, center + Math.sin(angle) * radius * ratio]
  }
  const ring = (ratio: number) => labels.map((_, index) => point(index, ratio).join(',')).join(' ')
  const dataPoints = values.map((value, index) => point(index, Math.max(0, Math.min(1, value / max))))
  return (
    <figure className="genui-radar-chart" aria-label={title}>
      <figcaption>{title}</figcaption>
      <svg className="genui-radar-plot" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${title}，${labels.length}个指标`}>
        {[0.25, 0.5, 0.75, 1].map((ratio) => <polygon key={ratio} className="genui-radar-grid" points={ring(ratio)} />)}
        {labels.map((_, index) => {
          const [x, y] = point(index, 1)
          return <line key={index} className="genui-radar-axis" x1={center} y1={center} x2={x} y2={y} />
        })}
        <polygon className="genui-radar-area" points={dataPoints.map((point) => point.join(',')).join(' ')} />
        {dataPoints.map(([x, y], index) => <circle key={index} className="genui-radar-point" cx={x} cy={y} r={3}><title>{`${labels[index]}：${values[index]}`}</title></circle>)}
        {labels.map((label, index) => {
          const [x, y] = point(index, 1.18)
          const anchor: 'start' | 'middle' | 'end' = Math.abs(x - center) < 8 ? 'middle' : x < center ? 'end' : 'start'
          return <text key={index} className="genui-radar-label" x={x} y={y} textAnchor={anchor} dominantBaseline="middle">{label}</text>
        })}
      </svg>
    </figure>
  )
}

export function RadialChartView({ title, labels, values }: SeriesChartProps) {
  const circumference = 2 * Math.PI * 26
  return (
    <figure className="genui-radial-chart" aria-label={title}>
      <figcaption>{title}</figcaption>
      <div className="genui-radial-grid">
        {labels.map((label, index) => {
          const value = values[index]
          const ratio = Math.max(0, Math.min(1, value / 100))
          return (
            <div className="genui-radial-item" key={index}>
              <svg viewBox="0 0 64 64" role="img" aria-label={`${label}：${value}`}>
                <circle className="genui-radial-track" cx="32" cy="32" r="26" />
                <circle className="genui-radial-value" cx="32" cy="32" r="26" strokeDasharray={`${circumference * ratio} ${circumference}`} transform="rotate(-90 32 32)" />
              </svg>
              <strong>{fullNumber.format(value)}</strong>
              <span>{label}</span>
            </div>
          )
        })}
      </div>
    </figure>
  )
}

export type ScatterChartProps = { title: string; xLabel: string; yLabel: string; xs: number[]; ys: number[] }

export function ScatterChartView({ title, xLabel, yLabel, xs, ys }: ScatterChartProps) {
  const width = 320
  const height = 160
  const left = 36
  const right = 12
  const top = 12
  const bottom = 28
  const xMin = Math.min(...xs)
  const xMax = Math.max(...xs)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const xSpan = xMax - xMin || 1
  const ySpan = yMax - yMin || 1
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const points = xs.map((x, index) => ({
    x: left + ((x - xMin) / xSpan) * plotWidth,
    y: top + ((yMax - ys[index]) / ySpan) * plotHeight,
    sourceX: x,
    sourceY: ys[index],
  }))
  return (
    <figure className="genui-scatter-chart" aria-label={title}>
      <figcaption><span>{title}</span><span className="genui-line-meta">{xLabel} × {yLabel}</span></figcaption>
      <svg className="genui-scatter-plot" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}，${points.length}个点`}>
        {[0, 1, 2].map((line) => {
          const y = top + (plotHeight * line) / 2
          return <line key={line} className="genui-line-grid" x1={left} x2={left + plotWidth} y1={y} y2={y} />
        })}
        <text className="genui-line-axis" x={left - 6} y={top + 3} textAnchor="end">{compactNumber.format(yMax)}</text>
        <text className="genui-line-axis" x={left - 6} y={top + plotHeight + 3} textAnchor="end">{compactNumber.format(yMin)}</text>
        <text className="genui-line-axis" x={left} y={height - 6} textAnchor="start">{xLabel}</text>
        {points.map((point, index) => <circle key={index} className="genui-scatter-point" cx={point.x} cy={point.y} r={3}><title>{`(${point.sourceX}, ${point.sourceY})`}</title></circle>)}
      </svg>
    </figure>
  )
}
