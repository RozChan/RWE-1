import type { ReactNode } from "react";
import { Icon } from "@/components/icons";

export function TopButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm hover:border-blue-200 hover:text-brand"
    >
      <Icon name={icon} className="h-4 w-4" />
      {label}
    </button>
  );
}

export function InfoBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="min-w-[155px] border-l border-slate-100 pl-5">
      <p className="text-[11px] font-semibold text-slate-500">{title}</p>
      <p className="mt-1.5 text-xs font-bold text-slate-700">{value}</p>
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  icon,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  icon?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
      <div className="flex min-h-14 items-center border-b border-slate-100 px-4">
        <div>
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            {icon && <Icon name={icon} className="h-4 w-4 text-slate-500" />}
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-slate-400">{subtitle}</p>
          )}
        </div>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </div>
  );
}
