import * as React from "react"
import { SectionHeading } from "@/components/SectionHeading"

// 设置分区卡片：带分组标题的外框容器
export function SettingsSection({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <section className="grid gap-2">
      <SectionHeading>{title}</SectionHeading>
      <div className="overflow-hidden rounded-md border border-[var(--oo-divider)] bg-background">{children}</div>
    </section>
  )
}

// 卡片内的单项设置行：左侧标题/描述，右侧控件
export function SettingsItem({
  children,
  description,
  title,
}: {
  children: React.ReactNode
  description?: React.ReactNode
  title: string
}) {
  return (
    <section className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 border-b border-[var(--oo-divider)] px-3 py-2.5 last:border-b-0 max-[760px]:grid-cols-1">
      <div className="min-w-0">
        <h3 className="oo-text-label truncate text-foreground">{title}</h3>
        {description ? <div className="oo-text-caption mt-0.5 max-w-[44rem]">{description}</div> : null}
      </div>
      <div className="min-w-0 justify-self-end max-[760px]:w-full max-[760px]:justify-self-stretch">{children}</div>
    </section>
  )
}
