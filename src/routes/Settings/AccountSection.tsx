import type { AuthAccountSummary } from "../../../electron/auth/common.ts"
import type { useAuth } from "@/hooks/useAuth"
import type { UserFacingError } from "@/lib/user-facing-error"

import { CheckIcon, CopyIcon, LogInIcon, LogOutIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { SettingsSection } from "./shared.tsx"
import { CachedAvatarImage } from "@/components/CachedAvatarImage"
import { ErrorNotice } from "@/components/ErrorNotice"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/i18n/i18n"
import { cn } from "@/lib/utils"

const copyFeedbackMs = 3000

// 「账户」分区：登录状态、账户信息与诊断复制
export function AccountSection({ auth }: { auth: ReturnType<typeof useAuth> }) {
  const { t } = useI18n()
  return (
    <SettingsSection title={t("settings.navAccount")}>
      <AccountSettings
        account={auth.state?.account}
        error={auth.error}
        loggingIn={auth.loggingIn}
        loggingOut={auth.loggingOut}
        onLogin={() => void auth.login()}
        onLogout={() => void auth.logout()}
      />
    </SettingsSection>
  )
}

function AccountSettings({
  account,
  error,
  loggingIn,
  loggingOut,
  onLogin,
  onLogout,
}: {
  account?: AuthAccountSummary
  error?: UserFacingError | null
  loggingIn: boolean
  loggingOut: boolean
  onLogin: () => void
  onLogout: () => void
}) {
  const { t } = useI18n()
  const accountCopy = useClipboardCopy()
  const displayName = account?.name.trim() || t("settings.account")
  const AccountCopyIcon = accountCopy.copied ? CheckIcon : CopyIcon

  return (
    <>
      <section className="grid min-h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-3 border-b border-[var(--oo-divider)] px-3 py-3 max-[760px]:grid-cols-1">
        <div className="flex min-w-0 items-center gap-3">
          <AccountAvatar name={displayName} avatarUrl={account?.avatarUrl} />
          <div className="min-w-0">
            <div className="oo-text-title truncate text-foreground">{displayName}</div>
            <div className="oo-text-caption truncate">{account ? t("settings.signedIn") : t("settings.signedOut")}</div>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 max-[760px]:justify-start">
          {account ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className={cn(accountCopy.copied && "bg-accent text-foreground hover:bg-accent hover:text-foreground")}
              onClick={() => void accountCopy.copyText(formatAccountInfo(account, t))}
            >
              <AccountCopyIcon className="size-4" />
              {accountCopy.copied ? t("settings.copied") : t("settings.copyAccountInfo")}
            </Button>
          ) : null}
          {account ? (
            <Button type="button" variant="outline" size="sm" disabled={loggingOut} onClick={onLogout}>
              <LogOutIcon className="size-4" />
              {t("settings.logout")}
            </Button>
          ) : (
            <Button type="button" size="sm" disabled={loggingIn} onClick={onLogin}>
              <LogInIcon className="size-4" />
              {loggingIn ? t("login.waiting") : t("login.button")}
            </Button>
          )}
        </div>
      </section>

      {account ? <AccountField label={t("settings.userId")} value={account.id} /> : null}

      {error ? <ErrorNotice error={error} compact className="m-3" /> : null}
    </>
  )
}

function AccountField({ label, value }: { label: string; value: string }) {
  const { t } = useI18n()
  const fieldCopy = useClipboardCopy()
  const FieldCopyIcon = fieldCopy.copied ? CheckIcon : CopyIcon

  return (
    <div className="grid min-h-12 grid-cols-[minmax(8rem,0.35fr)_minmax(0,1fr)_auto] items-center gap-3 border-b border-[var(--oo-divider)] px-3 py-2.5 max-[760px]:grid-cols-[minmax(0,1fr)_auto]">
      <div className="oo-text-label text-muted-foreground max-[760px]:col-span-2">{label}</div>
      <div className="oo-text-control min-w-0 truncate font-mono text-foreground">{value}</div>
      <button
        type="button"
        onClick={() => void fieldCopy.copyText(value)}
        className={cn(
          "grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
          fieldCopy.copied && "bg-accent text-foreground hover:bg-accent hover:text-foreground",
        )}
        aria-label={fieldCopy.copied ? t("settings.copied") : t("settings.copyField", { field: label })}
        title={fieldCopy.copied ? t("settings.copied") : t("settings.copyField", { field: label })}
      >
        <FieldCopyIcon className="size-4" />
      </button>
    </div>
  )
}

function AccountAvatar({ name, avatarUrl }: { name: string; avatarUrl?: string }) {
  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-foreground">
      <span aria-hidden="true">{name.trim().charAt(0).toLocaleUpperCase() || "L"}</span>
      <CachedAvatarImage src={avatarUrl} alt="" className="absolute inset-0 size-full object-cover" />
    </div>
  )
}

function useClipboardCopy(): { copied: boolean; copyText: (text: string) => Promise<boolean> } {
  const { t } = useI18n()
  const [copied, setCopied] = React.useState(false)
  const timeoutRef = React.useRef<number | undefined>(undefined)

  React.useEffect(
    () => () => {
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current)
      }
    },
    [],
  )

  const copyText = React.useCallback(
    async (text: string): Promise<boolean> => {
      const didCopy = await writeClipboardText(text)
      if (!didCopy) {
        setCopied(false)
        toast.error(t("settings.copyFailed"))
        return false
      }

      setCopied(true)
      if (timeoutRef.current !== undefined) {
        window.clearTimeout(timeoutRef.current)
      }
      timeoutRef.current = window.setTimeout(() => setCopied(false), copyFeedbackMs)
      return true
    },
    [t],
  )

  return { copied, copyText }
}

async function writeClipboardText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // 继续走 DOM fallback。
    }
  }

  const textarea = document.createElement("textarea")
  textarea.value = text
  textarea.setAttribute("readonly", "")
  textarea.style.position = "fixed"
  textarea.style.top = "-9999px"
  textarea.style.left = "-9999px"
  document.body.append(textarea)
  textarea.select()
  try {
    return document.execCommand("copy")
  } finally {
    textarea.remove()
  }
}

function formatAccountInfo(account: AuthAccountSummary, t: ReturnType<typeof useI18n>["t"]): string {
  const wanta = globalThis.wanta
  const version = wanta?.version ?? "unknown"
  const platform = wanta?.platform ?? "browser"
  const appCommit = wanta?.appCommit ?? "unknown"
  const lines = [
    t("settings.accountDiagnosticsTitle"),
    `${t("settings.accountName")}: ${account.name}`,
    `${t("settings.userId")}: ${account.id}`,
    `${t("settings.appVersion")}: ${version}`,
    `${t("settings.appCommit")}: ${appCommit}`,
    `${t("settings.platformName")}: ${platform}`,
  ]
  return lines.join("\n")
}
