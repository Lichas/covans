export interface GroupBackground {
  file: string
  label: string
}

export const GROUP_BACKGROUNDS: GroupBackground[] = [
  { file: '01-snowy-pine-forest-winter.png', label: '雪林' },
  { file: '02-sunny-seaside-cliff-flowers.png', label: '海崖花径' },
  { file: '03-starry-night-milky-way.png', label: '星夜' },
  { file: '04-rose-garden-terrace-lake-sunset.png', label: '玫瑰露台' },
  { file: '05-white-marble-terrace-seaview.png', label: '海景露台' },
  { file: '06-country-cottage-garden-lake.png', label: '湖畔小屋' },
  { file: '07-lakeside-valley-meadow-mountains.png', label: '山谷湖畔' },
  { file: '08-sunlit-classroom-window.png', label: '晴窗教室' },
  { file: '09-modern-office-city-view.png', label: '城市办公室' },
  { file: '10-city-night-skyline-river.png', label: '夜城河岸' },
  { file: '11-luxury-hotel-lobby.png', label: '酒店大堂' },
  { file: '12-forest-tennis-court.png', label: '林间球场' },
  { file: '13-amusement-park-ferris-wheel.png', label: '游乐园' },
]

export function isGroupBackground(file: string): boolean {
  return GROUP_BACKGROUNDS.some((background) => background.file === file)
}

export function randomGroupBackground(): string {
  if (!GROUP_BACKGROUNDS.length) return ''
  return GROUP_BACKGROUNDS[
    Math.floor(Math.random() * GROUP_BACKGROUNDS.length)
  ].file
}
