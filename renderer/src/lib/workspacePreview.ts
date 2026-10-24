export { artifactPreviewKind, extensionOfPath, languageForPath, type ArtifactPreviewKind } from '@shared/documentFormats'

export function fencedCode(content: string, language: string): string {
  const ticks = [...content.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  )
  const fence = '`'.repeat(Math.max(3, ticks + 1))
  return `${fence}${language}\n${content}\n${fence}`
}

export function workspaceFileUrl(botId: string, relPath: string): string {
  const encodedBot = encodeURIComponent(botId)
  const encodedPath = relPath
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')
  return `covan-workspace://file/${encodedBot}/${encodedPath}`
}
