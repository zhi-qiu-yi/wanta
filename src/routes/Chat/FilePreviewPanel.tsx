import type { LocalArtifactGroup, LocalArtifactItem } from "../../../electron/chat/common.ts"
import type { LocalArtifactPreviewCache } from "./artifact-preview-cache.ts"
import type { ArtifactContextMenuState } from "./ArtifactContextMenu.tsx"

import { ExternalLink, FolderOpen, Maximize2, Minimize2, PanelRightClose } from "lucide-react"
import * as React from "react"
import { ArtifactContextMenu } from "./ArtifactContextMenu.tsx"
import { ArtifactPreview } from "./ArtifactPreviewPane.tsx"
import { useArtifactFileActions } from "./use-artifact-file-actions.ts"
import { useChatService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import { useT } from "@/i18n/i18n"
import { reportRendererHandledError } from "@/lib/renderer-diagnostics"
import { cn } from "@/lib/utils"

export interface FilePreviewSelection {
  path: string
  line?: number | null
}

interface FilePreviewPanelProps {
  maximized: boolean
  selection: FilePreviewSelection | null
  showCollapseButton?: boolean
  windowControlsOnRight: boolean
  onCollapse: () => void
  onToggleMaximized: () => void
}

interface ResolvedPreviewTarget {
  group: LocalArtifactGroup | null
  item: LocalArtifactItem
}

function fileNameFromPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/, "")
  return normalized.split("/").pop() || filePath
}

export function FilePreviewPanel({
  maximized,
  selection,
  showCollapseButton = true,
  windowControlsOnRight,
  onCollapse,
  onToggleMaximized,
}: FilePreviewPanelProps) {
  const t = useT()
  const chatService = useChatService()
  const { openPath, showInFolder } = useArtifactFileActions()
  const previewCache = React.useRef<LocalArtifactPreviewCache>(new Map()).current
  const [contextMenu, setContextMenu] = React.useState<ArtifactContextMenuState | null>(null)
  const [target, setTarget] = React.useState<ResolvedPreviewTarget | null>(null)
  const [unavailable, setUnavailable] = React.useState(false)
  const path = selection?.path ?? null

  React.useEffect(() => {
    let cancelled = false
    setTarget(null)
    setUnavailable(false)
    if (!path) {
      return
    }
    void chatService
      .invoke("resolveLocalArtifacts", { artifactRoot: path, maxDirectoryItems: 1 })
      .then((result) => {
        if (cancelled) {
          return
        }
        const group = result.groups[0] ?? null
        const item = group?.root ?? group?.items[0] ?? null
        if (!item) {
          setUnavailable(true)
          return
        }
        setTarget({ group, item })
      })
      .catch((cause: unknown) => {
        if (cancelled) {
          return
        }
        reportRendererHandledError("filePreview.resolve", "Failed to resolve file preview target", cause)
        setUnavailable(true)
      })
    return () => {
      cancelled = true
    }
  }, [chatService, path])

  const MaximizeIcon = maximized ? Minimize2 : Maximize2
  const item = target?.item ?? null

  return (
    <aside
      className={cn(
        "oo-border-divider flex h-full min-h-0 w-full flex-col border-l bg-background",
        maximized && "border-l-0",
      )}
    >
      <ArtifactContextMenu
        menu={contextMenu}
        onClose={() => setContextMenu(null)}
        onOpenPath={openPath}
        onShowInFolder={showInFolder}
      />
      <header
        className={cn(
          "oo-titlebar oo-artifacts-titlebar oo-border-divider flex h-[var(--app-titlebar-height)] shrink-0 items-center justify-between gap-3 border-b [-webkit-app-region:drag]",
          windowControlsOnRight && "oo-titlebar-window-controls",
        )}
      >
        <div className="oo-text-title min-w-0 truncate">
          {item?.name ?? (path ? fileNameFromPath(path) : t("filePreview.title"))}
        </div>
        <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
          {item ? (
            <>
              <button
                type="button"
                title={t("artifacts.showInFolder")}
                aria-label={t("artifacts.showInFolder")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => showInFolder(item.path)}
              >
                <FolderOpen className="size-4" />
              </button>
              <button
                type="button"
                title={t("artifacts.openFile")}
                aria-label={t("artifacts.openFile")}
                className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
                onClick={() => openPath(item.path)}
              >
                <ExternalLink className="size-4" />
              </button>
            </>
          ) : null}
          <button
            type="button"
            title={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-label={maximized ? t("artifacts.restore") : t("artifacts.maximize")}
            aria-pressed={maximized}
            className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
            onClick={onToggleMaximized}
          >
            <MaximizeIcon className="size-4" />
          </button>
          {showCollapseButton ? (
            <button
              type="button"
              title={t("artifacts.collapse")}
              aria-label={t("artifacts.collapse")}
              className="oo-toolbar-button flex size-8 shrink-0 items-center justify-center rounded-md hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground"
              onClick={onCollapse}
            >
              <PanelRightClose className="size-4" />
            </button>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        {unavailable ? (
          <div className="flex min-h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <p className="oo-text-label text-foreground">{t("filePreview.unavailableTitle")}</p>
            <p className="oo-text-caption max-w-64 break-all text-muted-foreground">{path}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => openPath(path ?? undefined)}>
              <ExternalLink className="size-4" />
              {t("artifacts.openInSystem")}
            </Button>
          </div>
        ) : item ? (
          <ArtifactPreview
            group={target?.group ?? null}
            item={item}
            previewCache={previewCache}
            scrollToLine={selection?.line ?? null}
            onContextMenu={(menuItem, x, y) => setContextMenu({ item: menuItem, x, y })}
            onOpen={() => openPath(item.path)}
          />
        ) : (
          <div className="oo-text-body flex min-h-full items-center justify-center px-4 py-8 text-muted-foreground">
            {t("artifacts.previewLoading")}
          </div>
        )}
      </div>
    </aside>
  )
}
