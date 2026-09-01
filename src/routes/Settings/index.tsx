import type { SessionInfo } from "../../../electron/session/common.ts"
import type { UseAppUpdate } from "@/hooks/useAppUpdate"
import type { UseLinkRuntime } from "@/hooks/useLinkRuntime"
import type { MessageKey } from "@/i18n/i18n"

import {
  ArchiveIcon,
  CircleUserRoundIcon,
  FlaskConicalIcon,
  GlobeIcon,
  InfoIcon,
  ServerIcon,
  SlidersHorizontalIcon,
} from "lucide-react"
import * as React from "react"
import { AboutSection } from "./AboutSection.tsx"
import { AccountSection } from "./AccountSection.tsx"
import { BetaSection } from "./BetaSection.tsx"
import { BrowserSection } from "./BrowserSection.tsx"
import { GeneralSection } from "./GeneralSection.tsx"
import { RuntimeSection } from "./RuntimeSection.tsx"
import { shouldShowSelfManagedRuntimeSettings } from "./settings-presentation.ts"
import { PageRouteShell } from "@/components/PageRouteShell"
import { useAppSettings } from "@/hooks/useAppSettings"
import { useAttention } from "@/hooks/useAttention"
import { useAuth } from "@/hooks/useAuth"
import { useI18n } from "@/i18n/i18n"
import { cn } from "@/lib/utils"
import { ArchivedSessionsPanel } from "@/routes/Archived"

// 设置页左侧导航的分区标识；AppShell 通过受控 props 支持深链直达
export type SettingsSectionId = "general" | "account" | "archived" | "browser" | "runtime" | "about" | "beta"

// 「已归档」分区所需的会话操作，由 AppShell 从会话模型透传
export interface SettingsArchivedSessionsProps {
  listArchived: () => Promise<SessionInfo[]>
  refreshSessions: () => Promise<void>
  removeSession: (id: string) => Promise<void>
  ready: boolean
  unarchiveSession: (id: string) => Promise<SessionInfo | null>
}

const SETTINGS_SECTIONS: Array<{
  id: SettingsSectionId
  labelKey: MessageKey
  icon: React.ComponentType<{ className?: string }>
}> = [
  { id: "general", labelKey: "settings.navGeneral", icon: SlidersHorizontalIcon },
  { id: "account", labelKey: "settings.navAccount", icon: CircleUserRoundIcon },
  { id: "archived", labelKey: "archived.navTitle", icon: ArchiveIcon },
  { id: "browser", labelKey: "settings.groupBrowser", icon: GlobeIcon },
  { id: "runtime", labelKey: "settings.groupRuntime", icon: ServerIcon },
  { id: "about", labelKey: "settings.navAbout", icon: InfoIcon },
  { id: "beta", labelKey: "settings.groupBetaFeatures", icon: FlaskConicalIcon },
]

export function SettingsRoute({
  archivedSessions,
  linkRuntime,
  onBack,
  onSectionChange,
  section,
  titlebarActions,
  update,
}: {
  archivedSessions: SettingsArchivedSessionsProps
  onBack: () => void
  onSectionChange: (section: SettingsSectionId) => void
  linkRuntime: UseLinkRuntime
  section: SettingsSectionId
  titlebarActions: React.ReactNode
  update: UseAppUpdate
}) {
  const { t } = useI18n()
  const auth = useAuth()
  const appSettings = useAppSettings()
  const attention = useAttention()
  const showRuntimeSection = shouldShowSelfManagedRuntimeSettings(auth.state?.status)

  const visibleSections = SETTINGS_SECTIONS.filter((item) => item.id !== "runtime" || showRuntimeSection)
  // 深链目标可能被隐藏（如非自托管模式下的 runtime），回退到「通用」
  const activeSection = visibleSections.some((item) => item.id === section) ? section : "general"

  return (
    <PageRouteShell
      backLabel={t("settings.backToApp")}
      contentClassName="max-w-[72rem] gap-8"
      onBack={onBack}
      titlebarActions={titlebarActions}
    >
      <h1 className="oo-text-page-title">{t("settings.title")}</h1>

      <div className="grid grid-cols-[11rem_minmax(0,1fr)] items-start gap-8 max-[760px]:grid-cols-1 max-[760px]:gap-5">
        <nav
          aria-label={t("settings.title")}
          className="sticky top-0 grid gap-0.5 max-[760px]:static max-[760px]:flex max-[760px]:gap-1 max-[760px]:overflow-x-auto"
        >
          {visibleSections.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={activeSection === item.id ? "page" : undefined}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "oo-text-control flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left whitespace-nowrap",
                activeSection === item.id ? "bg-accent font-medium text-foreground" : "text-foreground hover:bg-muted",
              )}
            >
              <item.icon className="size-4 shrink-0" />
              {t(item.labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0">
          {activeSection === "general" ? <GeneralSection appSettings={appSettings} attention={attention} /> : null}
          {activeSection === "account" ? <AccountSection auth={auth} /> : null}
          {activeSection === "archived" ? (
            <ArchivedSessionsPanel
              listArchived={archivedSessions.listArchived}
              ready={archivedSessions.ready}
              refreshSessions={archivedSessions.refreshSessions}
              removeSession={archivedSessions.removeSession}
              unarchiveSession={archivedSessions.unarchiveSession}
            />
          ) : null}
          {activeSection === "browser" ? <BrowserSection appSettings={appSettings} /> : null}
          {activeSection === "runtime" ? (
            <RuntimeSection mode={appSettings.settings.operatingMode} runtime={linkRuntime} />
          ) : null}
          {activeSection === "about" ? <AboutSection update={update} /> : null}
          {activeSection === "beta" ? <BetaSection appSettings={appSettings} /> : null}
        </div>
      </div>
    </PageRouteShell>
  )
}
