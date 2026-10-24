const IMAGE_EXTENSIONS = new Set([
  'avif',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

const MARKDOWN_EXTENSIONS = new Set(['markdown', 'md', 'mdown', 'mkd'])
const TEXT_EXTENSIONS = new Set(['csv', 'log', 'text', 'tsv', 'txt'])
const HTML_EXTENSIONS = new Set(['htm', 'html'])
const PDF_EXTENSIONS = new Set(['pdf'])
const CODE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  bash: 'bash',
  c: 'c',
  cc: 'cpp',
  clj: 'clojure',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  dart: 'dart',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  kt: 'kotlin',
  lua: 'lua',
  mjs: 'javascript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  svelte: 'svelte',
  swift: 'swift',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
}

export type ArtifactPreviewKind =
  | 'markdown'
  | 'html'
  | 'text'
  | 'code'
  | 'image'
  | 'pdf'
  | 'unsupported'

export function extensionOfPath(path: string): string {
  const name = path.split('/').pop() || path
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function artifactPreviewKind(path: string): ArtifactPreviewKind {
  const ext = extensionOfPath(path)
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  if (HTML_EXTENSIONS.has(ext)) return 'html'
  if (TEXT_EXTENSIONS.has(ext)) return 'text'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (PDF_EXTENSIONS.has(ext)) return 'pdf'
  if (CODE_LANGUAGE_BY_EXTENSION[ext]) return 'code'
  return 'unsupported'
}

export function languageForPath(path: string): string {
  return CODE_LANGUAGE_BY_EXTENSION[extensionOfPath(path)] || 'text'
}


export const PRINT_DOCUMENT_EXTENSIONS = [...MARKDOWN_EXTENSIONS, ...TEXT_EXTENSIONS, ...HTML_EXTENSIONS, ...IMAGE_EXTENSIONS, ...PDF_EXTENSIONS, ...Object.keys(CODE_LANGUAGE_BY_EXTENSION)]
