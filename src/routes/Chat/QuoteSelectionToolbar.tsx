import { MessageCircle } from "lucide-react"
import * as React from "react"
import { createPortal } from "react-dom"
import { useT } from "@/i18n/i18n"

interface SelectedChatText {
  left: number
  range: Range
  text: string
  top: number
}

/** 监听消息区原生文本选区，并在选区上方提供引用入口。 */
export function QuoteSelectionToolbar({
  getRootElement,
  getScrollElement,
  onQuote,
}: {
  getRootElement: () => HTMLElement | null
  getScrollElement: () => HTMLElement | null
  onQuote: (text: string) => void
}) {
  const t = useT()
  const [selection, setSelection] = React.useState<SelectedChatText | null>(null)

  const clearSelection = React.useCallback(() => {
    const root = getRootElement()
    const nativeSelection = window.getSelection()
    if (root && nativeSelection && selectionBelongsToRoot(root, nativeSelection)) {
      nativeSelection.removeAllRanges()
    }
    setSelection(null)
  }, [getRootElement])

  const readSelection = React.useCallback(
    (finalize = false) => {
      const root = getRootElement()
      const nativeSelection = window.getSelection()
      if (!root || !nativeSelection || nativeSelection.rangeCount === 0 || nativeSelection.isCollapsed) {
        setSelection(null)
        return
      }

      let range = nativeSelection.getRangeAt(0)
      const ancestor = range.commonAncestorContainer
      const node = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentNode
      if (!node || !root.contains(node)) {
        setSelection(null)
        return
      }

      // 拖选完成后去掉块边界与首尾空白，使高亮范围和实际引用内容保持一致。
      if (finalize) {
        const trimmed = trimSelectionToText(range, root)
        if (!trimmed) {
          nativeSelection.removeAllRanges()
          setSelection(null)
          return
        }
        nativeSelection.removeAllRanges()
        nativeSelection.addRange(trimmed)
        range = trimmed
      }

      const text = nativeSelection.toString().trim()
      if (!text) {
        setSelection(null)
        return
      }
      const rect = selectionAnchorRect(range)
      if (rect.width === 0 && rect.height === 0) {
        setSelection(null)
        return
      }
      const left = Math.round(rect.left + rect.width / 2)
      const top = Math.round(Math.max(8, rect.top - 8))
      setSelection((previous) => {
        if (
          previous &&
          previous.text === text &&
          previous.left === left &&
          previous.top === top &&
          sameRangeBoundaries(previous.range, range)
        ) {
          return previous
        }
        return { left, range: range.cloneRange(), text, top }
      })
    },
    [getRootElement],
  )

  React.useEffect(() => {
    const scrollElement = getScrollElement()
    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target?.closest("[data-quote-selection-toolbar]")) {
        return
      }
      const root = getRootElement()
      const nativeSelection = window.getSelection()
      if (!root || !nativeSelection || !selectionBelongsToRoot(root, nativeSelection)) {
        return
      }
      nativeSelection.removeAllRanges()
      setSelection(null)
    }
    const handlePointerUp = (): void => {
      window.setTimeout(() => readSelection(true), 0)
    }
    const handleKeyUp = (): void => readSelection(true)
    const handleSelectionChange = (): void => readSelection(false)
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        clearSelection()
      }
    }

    document.addEventListener("pointerdown", handlePointerDown, true)
    document.addEventListener("selectionchange", handleSelectionChange)
    window.addEventListener("pointerup", handlePointerUp)
    window.addEventListener("keyup", handleKeyUp)
    window.addEventListener("keydown", handleKeyDown)
    scrollElement?.addEventListener("scroll", clearSelection, { passive: true })
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true)
      document.removeEventListener("selectionchange", handleSelectionChange)
      window.removeEventListener("pointerup", handlePointerUp)
      window.removeEventListener("keyup", handleKeyUp)
      window.removeEventListener("keydown", handleKeyDown)
      scrollElement?.removeEventListener("scroll", clearSelection)
    }
  }, [clearSelection, getRootElement, getScrollElement, readSelection])

  if (!selection) {
    return null
  }

  // Portal 避开聊天容器可能建立的定位上下文，确保 fixed 坐标始终相对窗口。
  return createPortal(
    <div
      data-quote-selection-toolbar
      className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-full border border-border bg-popover px-1 py-0.5 text-popover-foreground shadow-[0_4px_14px_rgba(0,0,0,0.10),0_1px_2px_rgba(0,0,0,0.06)] select-none"
      style={{ left: selection.left, top: selection.top }}
      onMouseDown={(event) => event.preventDefault()}
    >
      <button
        type="button"
        className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
        onClick={() => {
          onQuote(serializeSelection(selection.range))
          window.getSelection()?.removeAllRanges()
          setSelection(null)
        }}
      >
        <MessageCircle className="size-3.5" />
        {t("chat.quoteAddToConversation")}
      </button>
    </div>,
    document.body,
  )
}

/** 将完成的原生选区收敛到第一个和最后一个非空白字符。 */
function trimSelectionToText(range: Range, root: HTMLElement): Range | null {
  let first: { node: Text; offset: number } | null = null
  let last: { node: Text; offset: number } | null = null
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    if (!node.data || !range.intersectsNode(node)) {
      continue
    }
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.data.length
    if (start >= end) {
      continue
    }
    const selected = node.data.slice(start, end)
    const firstCharacter = selected.search(/\S/u)
    if (firstCharacter >= 0 && !first) {
      first = { node, offset: start + firstCharacter }
    }
    const trailingWhitespace = selected.match(/\s*$/u)?.[0].length ?? 0
    if (trailingWhitespace < selected.length) {
      last = { node, offset: end - trailingWhitespace }
    }
  }
  if (!first || !last) {
    return null
  }
  const trimmed = range.cloneRange()
  trimmed.setStart(first.node, first.offset)
  trimmed.setEnd(last.node, last.offset)
  return trimmed.collapsed ? null : trimmed
}

function sameRangeBoundaries(left: Range, right: Range): boolean {
  return (
    left.startContainer === right.startContainer &&
    left.startOffset === right.startOffset &&
    left.endContainer === right.endContainer &&
    left.endOffset === right.endOffset
  )
}

function selectionBelongsToRoot(root: HTMLElement, selection: Selection): boolean {
  for (let index = 0; index < selection.rangeCount; index += 1) {
    const range = selection.getRangeAt(index)
    const ancestor = range.commonAncestorContainer
    const node = ancestor.nodeType === Node.ELEMENT_NODE ? ancestor : ancestor.parentNode
    if (node && root.contains(node)) {
      return true
    }
  }
  return false
}

/** 将可见选区转为稳定文本，并把 KaTeX 展示节点还原为 LaTeX 源码。 */
function serializeSelection(range: Range): string {
  const container = document.createElement("div")
  container.appendChild(range.cloneContents())
  container.querySelectorAll(".katex").forEach((element) => {
    const tex = element.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim()
    element.replaceWith(document.createTextNode(tex ? `$$${tex}$$` : (element.textContent ?? "")))
  })
  container.style.cssText = "position:fixed;left:-99999px;top:0;white-space:pre-wrap;"
  document.body.appendChild(container)
  const text = container.innerText
  container.remove()
  return text.trim()
}

/** 以选区首行而不是整体包围盒定位，避免多行文本让浮层偏离起点。 */
function selectionAnchorRect(range: Range): DOMRect {
  const rects = selectionTextRects(range)
  if (rects.length === 0) {
    return range.getBoundingClientRect()
  }
  const top = Math.min(...rects.map((rect) => rect.top))
  const firstLine = rects.filter((rect) => rect.top <= top + 2)
  const left = Math.min(...firstLine.map((rect) => rect.left))
  const right = Math.max(...firstLine.map((rect) => rect.right))
  const bottom = Math.max(...firstLine.map((rect) => rect.bottom))
  return DOMRect.fromRect({ height: bottom - top, width: right - left, x: left, y: top })
}

function selectionTextRects(range: Range): DOMRect[] {
  const rects: DOMRect[] = []
  const pushTextNodeRects = (node: Text): void => {
    if (!node.data || !range.intersectsNode(node)) {
      return
    }
    const textRange = document.createRange()
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : node.data.length
    if (start >= end) {
      return
    }
    textRange.setStart(node, start)
    textRange.setEnd(node, end)
    rects.push(...Array.from(textRange.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0))
    textRange.detach()
  }
  if (range.commonAncestorContainer.nodeType === Node.TEXT_NODE) {
    pushTextNodeRects(range.commonAncestorContainer as Text)
    return rects
  }
  const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT)
  while (walker.nextNode()) {
    pushTextNodeRects(walker.currentNode as Text)
  }
  return rects
}
