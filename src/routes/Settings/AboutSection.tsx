import type { UpdateChannel } from "../../../electron/update/common.ts"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"

import { DownloadIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react"
import { branding } from "../../../electron/branding.ts"
import { SettingsItem, SettingsSection } from "./shared.tsx"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useI18n } from "@/i18n/i18n"
import { resolveUserFacingError } from "@/lib/user-facing-error"

const channelOptions = [
  { value: "stable", labelKey: "settings.channelStable" },
  { value: "beta", labelKey: "settings.channelBeta" },
] as const

// 「关于与更新」分区：版本信息、更新动作与更新渠道
export function AboutSection({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  return (
    <SettingsSection title={t("settings.navAbout")}>
      <AboutSettings update={update} />
      <SettingsItem title={t("settings.updateChannel")} description={t("settings.channelHint")}>
        <UpdateChannelSettings update={update} />
      </SettingsItem>
    </SettingsSection>
  )
}

function AboutSettings({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  const statusText = getUpdateStatusText(update, t)
  const updateStatus = update.state?.status
  const downloadingStatus = updateStatus?.status === "downloading" ? updateStatus : null
  const updateError =
    updateStatus?.status === "error" ? resolveUserFacingError(updateStatus.error, { area: "update" }) : null
  const percent = Math.round(downloadingStatus?.percent ?? 0)
  const version = update.state?.currentVersion ?? globalThis.wanta?.version ?? "—"
  const platform = globalThis.wanta?.platform ?? "browser"

  return (
    <section className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-[var(--oo-divider)] px-3 py-3 max-[760px]:grid-cols-1">
      <div className="grid min-w-0 gap-1">
        <div className="oo-text-label text-muted-foreground">{branding.appName}</div>
        <div className="oo-text-value text-foreground">v{version}</div>
        <div className="oo-text-caption">{t("settings.platform", { platform })}</div>
        {updateError ? null : <div className="oo-text-caption">{statusText}</div>}
        {updateError ? <ErrorNotice error={updateError} compact className="mt-2 max-w-xl" /> : null}
        {downloadingStatus ? <Progress value={percent} className="mt-3 h-1.5 max-w-sm" /> : null}
      </div>
      <UpdateAction update={update} />
    </section>
  )
}

function UpdateChannelSettings({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  return (
    <div className="grid max-w-[48rem] gap-3">
      <ToggleGroup
        type="single"
        value={update.state?.channel ?? "stable"}
        onValueChange={(value) => {
          if (value) {
            void update.setChannel(value as UpdateChannel)
          }
        }}
        variant="outline"
        size="sm"
        className="flex-wrap"
      >
        {channelOptions.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {t(option.labelKey)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}

function UpdateAction({ update }: { update: UseAppUpdate }) {
  const { t } = useI18n()
  const state = update.state
  if (!state || !state.isPackaged) {
    return null
  }
  switch (state.status.status) {
    case "checking":
      return (
        <Button variant="outline" size="sm" disabled>
          <RefreshCwIcon className="size-4 animate-spin" />
          {t("settings.updateChecking")}
        </Button>
      )
    case "available":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.download()}>
          <DownloadIcon className="size-4" />
          {t("settings.updateDownload")}
        </Button>
      )
    case "downloading":
      return (
        <Button variant="outline" size="sm" disabled>
          <DownloadIcon className="size-4" />
          {t("settings.updateDownloading", { percent: Math.round(state.status.percent ?? 0) })}
        </Button>
      )
    case "downloaded":
      return (
        <Button variant="outline" size="sm" onClick={() => void update.install()}>
          <RotateCcwIcon className="size-4" />
          {t("settings.updateRestart")}
        </Button>
      )
    default:
      return (
        <Button variant="outline" size="sm" onClick={() => void update.checkAndDownload()}>
          <RefreshCwIcon className="size-4" />
          {t("settings.updateCheck")}
        </Button>
      )
  }
}

function getUpdateStatusText(update: UseAppUpdate, t: ReturnType<typeof useI18n>["t"]): string {
  const state = update.state
  if (!state) {
    return " "
  }
  if (!state.isPackaged) {
    return t("settings.updateDevUnavailable")
  }
  switch (state.status.status) {
    case "checking":
      return t("settings.updateChecking")
    case "not-available":
      return t("settings.updateUpToDate")
    case "available":
      return t(state.channel === "beta" ? "settings.updateAvailableOnBeta" : "settings.updateAvailable", {
        version: state.status.version,
      })
    case "downloaded":
      return t("settings.updateDownloaded", { version: state.status.version })
    case "downloading":
      return t("settings.updateDownloading", { percent: Math.round(state.status.percent ?? 0) })
    case "error":
      return t("error.update.title")
    default:
      return t("settings.updateIdle")
  }
}
