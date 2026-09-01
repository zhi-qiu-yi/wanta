import type { useAppSettings } from "@/hooks/useAppSettings"

import { RefreshCwIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { SettingsItem, SettingsSection } from "./shared.tsx"
import { useBrowserService } from "@/components/AppContext"
import { Button } from "@/components/ui/button"
import {
  ConfirmDialog,
  ConfirmDialogAction,
  ConfirmDialogCancel,
  ConfirmDialogContent,
  ConfirmDialogDescription,
  ConfirmDialogFooter,
  ConfirmDialogHeader,
  ConfirmDialogTitle,
} from "@/components/ui/confirm-dialog"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/i18n/i18n"

// 「浏览器」分区：内置浏览器开关、数据清理与下载目录
export function BrowserSection({ appSettings }: { appSettings: ReturnType<typeof useAppSettings> }) {
  const { t } = useI18n()
  return (
    <SettingsSection title={t("settings.groupBrowser")}>
      <BrowserSettings
        enabled={appSettings.settings.browserEnabled}
        loading={appSettings.loading}
        onEnabledChange={appSettings.setBrowserEnabled}
      />
    </SettingsSection>
  )
}

function BrowserSettings({
  enabled,
  loading,
  onEnabledChange,
}: {
  enabled: boolean
  loading: boolean
  onEnabledChange: (enabled: boolean) => Promise<void>
}) {
  const { t } = useI18n()
  const browserService = useBrowserService()
  const [saving, setSaving] = React.useState(false)
  const [clearDialogOpen, setClearDialogOpen] = React.useState(false)
  const [clearing, setClearing] = React.useState(false)

  return (
    <>
      <SettingsItem title={t("settings.browserEnabled")} description={t("settings.browserEnabledDescription")}>
        <Switch
          checked={enabled}
          disabled={loading || saving}
          aria-label={t("settings.browserEnabled")}
          onCheckedChange={(next) => {
            setSaving(true)
            void onEnabledChange(next)
              .catch((error: unknown) => {
                toast.error(t("settings.browserUpdateFailed"))
                console.error("[wanta] update browser setting failed", error)
              })
              .finally(() => setSaving(false))
          }}
        />
      </SettingsItem>
      <SettingsItem title={t("settings.browserData")} description={t("settings.browserDataDescription")}>
        <Button type="button" variant="outline" size="sm" onClick={() => setClearDialogOpen(true)}>
          {t("settings.browserClearData")}
        </Button>
      </SettingsItem>
      <SettingsItem title={t("settings.browserDownloads")} description={t("settings.browserDownloadsDescription")}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            void browserService.invoke("openDownloadsFolder").catch((error: unknown) => {
              toast.error(t("settings.browserOpenDownloadsFailed"))
              console.error("[wanta] open browser downloads folder failed", error)
            })
          }}
        >
          {t("settings.browserOpenDownloads")}
        </Button>
      </SettingsItem>
      <ConfirmDialog
        open={clearDialogOpen}
        onOpenChange={(open) => {
          if (!clearing) setClearDialogOpen(open)
        }}
      >
        <ConfirmDialogContent>
          <ConfirmDialogHeader>
            <ConfirmDialogTitle>{t("settings.browserClearConfirmTitle")}</ConfirmDialogTitle>
            <ConfirmDialogDescription>{t("settings.browserClearConfirmDescription")}</ConfirmDialogDescription>
          </ConfirmDialogHeader>
          <ConfirmDialogFooter>
            <ConfirmDialogCancel disabled={clearing}>{t("settings.browserClearCancel")}</ConfirmDialogCancel>
            <ConfirmDialogAction
              disabled={clearing}
              onClick={(event) => {
                event.preventDefault()
                setClearing(true)
                void browserService
                  .invoke("clearData")
                  .then(() => {
                    toast.success(t("settings.browserClearSuccess"))
                    setClearDialogOpen(false)
                  })
                  .catch((error: unknown) => {
                    toast.error(t("settings.browserClearFailed"))
                    console.error("[wanta] clear browser data failed", error)
                  })
                  .finally(() => setClearing(false))
              }}
            >
              {clearing ? <RefreshCwIcon className="size-4 animate-spin" /> : null}
              {t("settings.browserClearConfirmAction")}
            </ConfirmDialogAction>
          </ConfirmDialogFooter>
        </ConfirmDialogContent>
      </ConfirmDialog>
    </>
  )
}
