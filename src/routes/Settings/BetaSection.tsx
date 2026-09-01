import type { useAppSettings } from "@/hooks/useAppSettings"

import * as React from "react"
import { toast } from "sonner"
import { SettingsItem, SettingsSection } from "./shared.tsx"
import { Switch } from "@/components/ui/switch"
import { useI18n } from "@/i18n/i18n"

// 「Beta 功能」分区：实验性特性开关
export function BetaSection({ appSettings }: { appSettings: ReturnType<typeof useAppSettings> }) {
  const { t } = useI18n()
  return (
    <SettingsSection title={t("settings.groupBetaFeatures")}>
      <SettingsItem title={t("settings.knowledgeBeta")} description={t("settings.knowledgeBetaDescription")}>
        <KnowledgeBetaToggle
          enabled={appSettings.settings.knowledgeBaseBetaEnabled}
          loading={appSettings.loading}
          onChange={appSettings.setKnowledgeBaseBetaEnabled}
        />
      </SettingsItem>
    </SettingsSection>
  )
}

function KnowledgeBetaToggle({
  enabled,
  loading,
  onChange,
}: {
  enabled: boolean
  loading: boolean
  onChange: (enabled: boolean) => Promise<void>
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const disabled = loading || saving

  return (
    <Switch
      checked={enabled}
      disabled={disabled}
      aria-label={t("settings.knowledgeBeta")}
      onCheckedChange={(next) => {
        setSaving(true)
        void onChange(next)
          .catch((error: unknown) => {
            toast.error(t("settings.knowledgeBetaUpdateFailed"))
            console.error("[wanta] update knowledge beta setting failed", error)
          })
          .finally(() => setSaving(false))
      }}
    />
  )
}
