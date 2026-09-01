import type { CustomModelSummary } from "../../../electron/models/common.ts"
import type { OperatingMode } from "../../../electron/settings/common.ts"
import type { UseLinkRuntime } from "@/hooks/useLinkRuntime"
import type { MessageKey } from "@/i18n/i18n"

import {
  BrainCircuitIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  PencilIcon,
  PlusIcon,
  ServerIcon,
  Trash2Icon,
} from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { SettingsItem, SettingsSection } from "./shared.tsx"
import { ErrorNotice } from "@/components/ErrorNotice"
import { OpenConnectorEndpointFields } from "@/components/OpenConnectorEndpointFields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useI18n } from "@/i18n/i18n"
import {
  hasCompleteOpenConnectorEndpoints,
  inferOpenConnectorDeploymentMode,
  resolveOpenConnectorConsoleUrl,
} from "@/lib/openconnector-deployment"
import { cn } from "@/lib/utils"
import { AddCustomModelDialog } from "@/routes/Chat/AddCustomModelDialog"
import { useModelCatalog } from "@/routes/Chat/useModelCatalog"

// 「运行环境」分区（仅自托管模式可见）：运行时档案、模型目录与 OpenConnector 连接
export function RuntimeSection({ mode, runtime }: { mode: OperatingMode | null; runtime: UseLinkRuntime }) {
  const { t } = useI18n()
  const models = useModelCatalog()

  return (
    <SettingsSection title={t("settings.groupRuntime")}>
      <RuntimeProfileSummary mode={mode} />
      <ModelSettings connectorsEnabled={false} models={models} />
      <LinkRuntimeSettings runtime={runtime} />
    </SettingsSection>
  )
}

function RuntimeProfileSummary({ mode }: { mode: OperatingMode | null }) {
  const { t } = useI18n()
  const description =
    mode === "self-managed"
      ? t("settings.runtimeProfileSelfDescription")
      : t("settings.runtimeProfileUnselectedDescription")
  const label =
    mode === "self-managed" ? t("settings.runtimeProfileSelfManaged") : t("settings.runtimeProfileUnselected")
  return (
    <SettingsItem title={t("settings.runtimeProfile")} description={description}>
      <span className="oo-text-caption rounded-full border bg-background px-2.5 py-1 font-medium text-foreground">
        {label}
      </span>
    </SettingsItem>
  )
}

function ModelSettings({
  connectorsEnabled,
  models,
}: {
  connectorsEnabled: boolean
  models: ReturnType<typeof useModelCatalog>
}) {
  const { t } = useI18n()
  const [editingModel, setEditingModel] = React.useState<CustomModelSummary | undefined>()
  const catalog = models.catalog
  const selectedCustomId = catalog?.selected.kind === "custom" ? catalog.selected.id : null
  const selectedBuiltinId = catalog?.selected.kind === "builtin" ? catalog.selected.id : null
  const selectedModel =
    catalog?.selected.kind === "custom"
      ? catalog.customModels.find((item) => item.id === catalog.selected.id)?.displayName
      : connectorsEnabled
        ? catalog?.builtins.find((item) => item.id === catalog.selected.id)?.displayName
        : undefined

  const openAdd = () => {
    setEditingModel(undefined)
    models.openDialog()
  }
  const openEdit = (model: CustomModelSummary) => {
    setEditingModel(model)
    models.openDialog()
  }
  const closeDialog = () => {
    setEditingModel(undefined)
    models.closeDialog()
  }

  return (
    <section className="grid gap-4 border-b border-[var(--oo-divider)] px-3 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
            <BrainCircuitIcon className="size-4" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="oo-text-label text-foreground">{t("settings.modelsTitle")}</h3>
              <span className="oo-text-caption rounded-full border px-2 py-0.5">{t("settings.required")}</span>
            </div>
            <p className="oo-text-caption mt-0.5">
              {selectedModel
                ? t("settings.modelsCurrent", { model: selectedModel })
                : t("settings.modelsNotConfigured")}
            </p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={openAdd}>
          <PlusIcon className="size-4" />
          {t("settings.modelsAdd")}
        </Button>
      </div>

      {catalog ? (
        <div className="grid gap-2">
          {connectorsEnabled && catalog.builtins.length > 0 ? (
            <div className="grid gap-1.5">
              <p className="oo-text-caption-compact font-medium text-muted-foreground">{t("settings.modelsOomol")}</p>
              {catalog.builtins.map((model) => (
                <ModelRow
                  key={model.id}
                  active={selectedBuiltinId === model.id}
                  description={model.providerName}
                  name={model.displayName}
                  onSelect={() => models.selectModel({ kind: "builtin", id: model.id })}
                />
              ))}
            </div>
          ) : null}

          <div className="grid gap-1.5">
            <p className="oo-text-caption-compact font-medium text-muted-foreground">{t("settings.modelsCustom")}</p>
            {catalog.customModels.length > 0 ? (
              catalog.customModels.map((model) => (
                <ModelRow
                  key={model.id}
                  active={selectedCustomId === model.id}
                  description={`${model.providerName} · ${model.modelName}`}
                  name={model.displayName}
                  onEdit={() => openEdit(model)}
                  onDelete={() => {
                    if (globalThis.confirm(t("settings.modelsDeleteConfirm", { model: model.displayName }))) {
                      models.deleteModel(model.id)
                    }
                  }}
                  onSelect={() => models.selectModel({ kind: "custom", id: model.id })}
                />
              ))
            ) : (
              <div className="rounded-lg border border-dashed px-3 py-4 text-center">
                <p className="oo-text-caption">{t("settings.modelsEmpty")}</p>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {models.catalogError ? <ErrorNotice error={models.catalogError} compact /> : null}
      {models.selectionError ? <ErrorNotice error={models.selectionError} compact /> : null}
      <AddCustomModelDialog
        connectorsEnabled={connectorsEnabled}
        model={editingModel}
        open={models.dialogOpen}
        providers={catalog?.providers ?? []}
        error={models.dialogError}
        onClose={closeDialog}
        onSave={models.saveModel}
      />
    </section>
  )
}

function ModelRow({
  active,
  description,
  name,
  onDelete,
  onEdit,
  onSelect,
}: {
  active: boolean
  description: string
  name: string
  onDelete?: () => void
  onEdit?: () => void
  onSelect: () => void
}) {
  const { t } = useI18n()
  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2",
        active && "border-primary/40 bg-primary/[0.035]",
      )}
    >
      <button type="button" className="min-w-0 flex-1 text-left" onClick={onSelect}>
        <span className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full border", active && "border-primary bg-primary")} />
          <span className="oo-text-label truncate">{name}</span>
        </span>
        <span className="oo-text-caption ml-4 block truncate">{description}</span>
      </button>
      {onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title={t("settings.modelsEdit")}
          onClick={onEdit}
        >
          <PencilIcon className="size-4" />
        </Button>
      ) : null}
      {onDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title={t("settings.modelsDelete")}
          onClick={onDelete}
        >
          <Trash2Icon className="size-4" />
        </Button>
      ) : null}
    </div>
  )
}

function LinkRuntimeSettings({ runtime }: { runtime: UseLinkRuntime }) {
  const { t } = useI18n()
  const [baseUrl, setBaseUrl] = React.useState("")
  const [consoleUrl, setConsoleUrl] = React.useState("")
  const [deploymentMode, setDeploymentMode] = React.useState(() => inferOpenConnectorDeploymentMode(undefined))
  const [runtimeToken, setRuntimeToken] = React.useState("")
  const state = runtime.state
  const saved = state?.openConnector

  React.useEffect(() => {
    setBaseUrl(saved?.baseUrl ?? "")
    setConsoleUrl(saved?.consoleUrl ?? "")
    setDeploymentMode(inferOpenConnectorDeploymentMode(saved))
  }, [saved?.baseUrl, saved?.consoleUrl])

  const endpointConfigurationComplete = hasCompleteOpenConnectorEndpoints(deploymentMode, baseUrl, consoleUrl)
  const changeDeploymentMode = (nextMode: typeof deploymentMode) => {
    setDeploymentMode(nextMode)
    if (nextMode === "local" && consoleUrl.trim() === baseUrl.trim()) setConsoleUrl("")
  }

  const reportFailure = React.useCallback(
    (cause: unknown) => {
      toast.error(t("settings.linkRuntimeActionFailed"))
      console.error("[wanta] Link runtime action failed", cause)
    },
    [t],
  )
  const save = () => {
    const token = runtimeToken.trim()
    void runtime
      .saveOpenConnector({
        baseUrl,
        consoleUrl: resolveOpenConnectorConsoleUrl(deploymentMode, baseUrl, consoleUrl),
        ...(token ? { runtimeToken: token } : {}),
      })
      .then(() => {
        setRuntimeToken("")
        toast.success(t("settings.linkRuntimeSaved"))
      })
      .catch(reportFailure)
  }
  const test = () => {
    const token = runtimeToken.trim()
    void runtime
      .testOpenConnector({ baseUrl, ...(token ? { runtimeToken: token } : {}) })
      .then((result) => {
        if (result.kind === "online") toast.success(t("settings.linkRuntimeTestOnline"))
        else if (result.kind === "unauthorized") toast.error(t("settings.linkRuntimeTestUnauthorized"))
        else if (result.kind === "offline") toast.error(t("settings.linkRuntimeTestOffline"))
        else toast.error(t("settings.linkRuntimeTestIncompatible"))
      })
      .catch(reportFailure)
  }

  return (
    <>
      <SettingsItem title={t("settings.connectionsTitle")} description={t("settings.connectionsDescription")}>
        <span className="oo-text-caption rounded-full border px-2.5 py-1">
          {state?.active === "oomol"
            ? "Wanta"
            : state?.active === "openconnector"
              ? "OpenConnector"
              : t("settings.connectionsModelOnly")}
        </span>
      </SettingsItem>

      <section className="grid gap-4 border-b border-[var(--oo-divider)] px-3 py-4 last:border-b-0">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ServerIcon className="size-4 text-muted-foreground" />
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="oo-text-label text-foreground">{t("settings.openConnectorTitle")}</h3>
                <span className="oo-text-caption-compact rounded-full border px-2 py-0.5">
                  {t("settings.optional")}
                </span>
              </div>
              <p className="oo-text-caption">
                {t(
                  runtime.loading || runtime.busy
                    ? "settings.linkRuntimeStatusChecking"
                    : linkRuntimeStatusKey(runtime.status.kind),
                )}
              </p>
            </div>
          </div>
          <span className="oo-text-caption rounded-full border px-2 py-0.5">
            {!saved
              ? t("settings.openConnectorNotConfigured")
              : state?.active === "openconnector"
                ? t("settings.linkRuntimeInUse")
                : state?.selected === "openconnector"
                  ? t("settings.linkRuntimeUnavailable")
                  : t("settings.linkRuntimeNotSelected")}
          </span>
        </div>

        <OpenConnectorEndpointFields
          baseUrl={baseUrl}
          consoleUrl={consoleUrl}
          disabled={runtime.busy}
          mode={deploymentMode}
          onBaseUrlChange={setBaseUrl}
          onConsoleUrlChange={setConsoleUrl}
          onModeChange={changeDeploymentMode}
        />

        <label className="grid gap-1.5">
          <span className="oo-text-label flex items-center gap-1.5">
            <KeyRoundIcon className="size-3.5" />
            {t("settings.openConnectorRuntimeToken")}
          </span>
          <Input
            type="password"
            autoComplete="off"
            value={runtimeToken}
            placeholder={
              saved?.tokenConfigured
                ? t("settings.openConnectorTokenConfigured")
                : t("settings.openConnectorTokenOptional")
            }
            disabled={runtime.busy}
            onChange={(event) => setRuntimeToken(event.target.value)}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={runtime.busy || !baseUrl.trim()} onClick={test}>
            {t("settings.openConnectorTest")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={runtime.busy || !endpointConfigurationComplete}
            onClick={save}
          >
            {t("common.save")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={runtime.busy || !saved?.consoleUrl}
            onClick={() => {
              if (saved?.consoleUrl) window.open(saved.consoleUrl, "_blank", "noopener,noreferrer")
            }}
          >
            <ExternalLinkIcon className="size-4" />
            {t("settings.openConnectorOpenConsole")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={runtime.busy || !saved?.tokenConfigured}
            onClick={() => {
              if (!globalThis.confirm(t("settings.openConnectorClearTokenConfirm"))) return
              setRuntimeToken("")
              void runtime.clearOpenConnectorToken().catch(reportFailure)
            }}
          >
            {t("settings.openConnectorClearToken")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={runtime.busy || !saved}
            onClick={() => {
              if (!globalThis.confirm(t("settings.openConnectorRemoveConfirm"))) return
              void runtime.removeOpenConnector().catch(reportFailure)
            }}
          >
            <Trash2Icon className="size-4" />
            {t("settings.openConnectorRemove")}
          </Button>
        </div>
      </section>
    </>
  )
}

function linkRuntimeStatusKey(kind: UseLinkRuntime["status"]["kind"]): MessageKey {
  switch (kind) {
    case "online":
      return "settings.linkRuntimeStatusOnline"
    case "offline":
      return "settings.linkRuntimeStatusOffline"
    case "unauthorized":
      return "settings.linkRuntimeStatusUnauthorized"
    case "incompatible":
      return "settings.linkRuntimeStatusIncompatible"
    case "unknown":
      return "settings.linkRuntimeStatusUnknown"
  }
}
