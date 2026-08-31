import * as React from "react"

export type OpenFilePreview = (path: string, line?: number | null) => void

/**
 * 消息里的本地文件链接通过该上下文请求右侧栏预览。
 * 不在 AppShell 下（如测试、独立渲染）时为 null，调用方需回退到系统外开。
 */
export const FilePreviewContext = React.createContext<OpenFilePreview | null>(null)

export function useOpenFilePreview(): OpenFilePreview | null {
  return React.useContext(FilePreviewContext)
}
