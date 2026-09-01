import type { NotificationCapability, NotificationTestResult } from "../../../electron/attention/common.ts"
import type { CompletionNotificationCondition } from "../../../electron/settings/common.ts"
import type { ThemePreference } from "@/components/theme-context"
import type { useAppSettings } from "@/hooks/useAppSettings"
import type { Locale, MessageKey } from "@/i18n/i18n"

import { BellRingIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { notificationPresentation } from "./notification-presentation.ts"
import { SettingsItem, SettingsSection } from "./shared.tsx"
import { useTheme } from "@/components/theme-context"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useI18n } from "@/i18n/i18n"

const themeOptions = [
  { value: "light", labelKey: "settings.themeLight", icon: SunIcon },
  { value: "dark", labelKey: "settings.themeDark", icon: MoonIcon },
  { value: "system", labelKey: "settings.themeSystem", icon: MonitorIcon },
] as const

const localeOptions: Array<{ value: Locale; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
]

const completionNotificationOptions = [
  { value: "never", labelKey: "settings.notificationNever" },
  { value: "background", labelKey: "settings.notificationBackground" },
  { value: "always", labelKey: "settings.notificationAlways" },
] as const

// 「通用」分区：外观、语言与任务通知
export function GeneralSection({
  appSettings,
  attention,
}: {
  appSettings: ReturnType<typeof useAppSettings>
  attention: {
    notificationCapability: NotificationCapability | null
    openSystemNotificationSettings: () => Promise<void>
    testCompletionNotification: () => Promise<NotificationTestResult>
  }
}) {
  const { preference, setPreference } = useTheme()
  const { locale, setLocale, t } = useI18n()

  return (
    <div className="grid gap-5">
      <SettingsSection title={t("settings.navGeneral")}>
        <SettingsItem title={t("settings.appearance")}>
          <ThemeSettings preference={preference} setPreference={setPreference} />
        </SettingsItem>
        <SettingsItem title={t("settings.language")}>
          <LanguageSettings locale={locale} setLocale={setLocale} />
        </SettingsItem>
      </SettingsSection>

      <SettingsSection title={t("settings.groupNotifications")}>
        <NotificationSettings
          capability={attention.notificationCapability}
          loading={appSettings.loading}
          settings={appSettings.settings}
          onConditionChange={appSettings.setCompletionNotificationCondition}
          onSoundChange={appSettings.setNotificationSoundEnabled}
          onOpenSystemSettings={attention.openSystemNotificationSettings}
          onBadgeChange={appSettings.setUnreadBadgeEnabled}
          onTest={attention.testCompletionNotification}
        />
      </SettingsSection>
    </div>
  )
}

function ThemeSettings({
  preference,
  setPreference,
}: {
  preference: ThemePreference
  setPreference: (preference: ThemePreference) => void
}) {
  const { t } = useI18n()
  return (
    <ToggleGroup
      type="single"
      value={preference}
      onValueChange={(value) => {
        if (value) {
          setPreference(value as ThemePreference)
        }
      }}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {themeOptions.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          <option.icon className="size-4" />
          {t(option.labelKey)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function LanguageSettings({ locale, setLocale }: { locale: Locale; setLocale: (locale: Locale) => void }) {
  return (
    <ToggleGroup
      type="single"
      value={locale}
      onValueChange={(value) => {
        if (value) {
          setLocale(value as Locale)
        }
      }}
      variant="outline"
      size="sm"
      className="flex-wrap"
    >
      {localeOptions.map((option) => (
        <ToggleGroupItem key={option.value} value={option.value}>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function NotificationSettings({
  capability,
  loading,
  onBadgeChange,
  onConditionChange,
  onOpenSystemSettings,
  onSoundChange,
  onTest,
  settings,
}: {
  capability: NotificationCapability | null
  loading: boolean
  onBadgeChange: (enabled: boolean) => Promise<void>
  onConditionChange: (condition: CompletionNotificationCondition) => Promise<void>
  onOpenSystemSettings: () => Promise<void>
  onSoundChange: (enabled: boolean) => Promise<void>
  onTest: () => Promise<NotificationTestResult>
  settings: ReturnType<typeof useAppSettings>["settings"]
}) {
  const { t } = useI18n()
  const [saving, setSaving] = React.useState(false)
  const [testing, setTesting] = React.useState(false)
  const [lastTestResult, setLastTestResult] = React.useState<NotificationTestResult | null>(null)
  const disabled = loading || saving || testing
  const testDisabled =
    disabled || !capability || capability.status === "unsupported" || capability.status === "development-unavailable"
  const presentation = notificationPresentation(capability, lastTestResult)

  const save = React.useCallback(
    (task: Promise<void>) => {
      setSaving(true)
      void task
        .catch((error: unknown) => {
          toast.error(t("settings.notificationsUpdateFailed"))
          console.error("[wanta] update notification setting failed", error)
        })
        .finally(() => setSaving(false))
    },
    [t],
  )

  return (
    <>
      <SettingsItem title={t("settings.notificationSystemStatus")} description={t(presentation.descriptionKey)}>
        <div className="flex flex-wrap justify-end gap-2 max-[760px]:justify-start">
          {presentation.recovery && capability?.canOpenSystemSettings ? (
            <SystemNotificationSettingsButton
              disabled={disabled}
              labelKey={presentation.settingsLabelKey}
              onOpen={onOpenSystemSettings}
            />
          ) : null}
          <Button
            type="button"
            variant={presentation.recovery ? "outline" : "default"}
            size="sm"
            disabled={testDisabled}
            onClick={() => {
              setTesting(true)
              void onTest()
                .then((result) => {
                  setLastTestResult(result)
                  switch (result.outcome) {
                    case "delivered":
                      toast.success(t("settings.notificationTestDelivered"))
                      return
                    case "accepted":
                      if (capability?.platform === "darwin") {
                        toast.warning(t("settings.notificationTestUnconfirmed"))
                      } else {
                        toast.success(t("settings.notificationTestAccepted"))
                      }
                      return
                  }
                  toast.error(t(notificationTestFailureKey(result)))
                  console.error("[wanta] test notification was not delivered", result)
                })
                .catch((error: unknown) => {
                  setLastTestResult({
                    error: error instanceof Error ? error.message : String(error),
                    outcome: "failed",
                  })
                  toast.error(t("settings.notificationTestFailed"))
                  console.error("[wanta] test notification failed", error)
                })
                .finally(() => setTesting(false))
            }}
          >
            <BellRingIcon className="size-4" />
            {t(presentation.testLabelKey)}
          </Button>
          {!presentation.recovery && capability?.canOpenSystemSettings ? (
            <SystemNotificationSettingsButton
              disabled={disabled}
              labelKey={presentation.settingsLabelKey}
              onOpen={onOpenSystemSettings}
            />
          ) : null}
        </div>
      </SettingsItem>
      <SettingsItem title={t("settings.notifications")} description={t("settings.notificationsDescription")}>
        <ToggleGroup
          type="single"
          value={settings.completionNotificationCondition}
          onValueChange={(value) => {
            if (value) save(onConditionChange(value as CompletionNotificationCondition))
          }}
          variant="outline"
          size="sm"
          disabled={disabled}
          className="flex-wrap justify-end max-[760px]:grid max-[760px]:w-full max-[760px]:grid-cols-3"
        >
          {completionNotificationOptions.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="max-[760px]:w-full">
              {t(option.labelKey)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </SettingsItem>
      <SettingsItem title={t("settings.notificationSound")} description={t("settings.notificationSoundDescription")}>
        <Switch
          checked={settings.notificationSoundEnabled}
          disabled={disabled}
          aria-label={t("settings.notificationSound")}
          onCheckedChange={(enabled) => save(onSoundChange(enabled))}
        />
      </SettingsItem>
      <SettingsItem title={t("settings.notificationBadge")} description={t("settings.notificationBadgeDescription")}>
        <Switch
          checked={settings.unreadBadgeEnabled}
          disabled={disabled}
          aria-label={t("settings.notificationBadge")}
          onCheckedChange={(enabled) => save(onBadgeChange(enabled))}
        />
      </SettingsItem>
    </>
  )
}

function SystemNotificationSettingsButton({
  disabled,
  labelKey,
  onOpen,
}: {
  disabled: boolean
  labelKey: MessageKey
  onOpen: () => Promise<void>
}) {
  const { t } = useI18n()
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={() => {
        void onOpen().catch((error: unknown) => {
          toast.error(t("settings.notificationSettingsOpenFailed"))
          console.error("[wanta] open system notification settings failed", error)
        })
      }}
    >
      {t(labelKey)}
    </Button>
  )
}

function notificationTestFailureKey(
  result: NotificationTestResult,
): "settings.notificationTestFailed" | "settings.notificationTestTimedOut" | "settings.notificationUnsupported" {
  switch (result.outcome) {
    case "timed-out":
      return "settings.notificationTestTimedOut"
    case "unsupported":
      return "settings.notificationUnsupported"
    default:
      return "settings.notificationTestFailed"
  }
}
