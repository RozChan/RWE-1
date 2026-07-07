import type { AgentPlan } from "@/lib/types";
import { describeOperationImpact } from "@/lib/agent-plan-descriptions";

type AgentPlanCardProps = {
  plan: AgentPlan;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function AgentPlanCard({
  plan: agentPlan,
  loading,
  onConfirm,
  onCancel,
}: AgentPlanCardProps) {
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-emerald-800">我准备这样做</p>
          <p className="mt-1 text-[11px] leading-5 text-slate-600">
            {agentPlan.assistantReply}
          </p>
        </div>
        <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-emerald-700">
          {agentPlan.operations.length} 个操作
        </span>
      </div>
      <div className="mt-3 rounded-lg bg-white px-2.5 py-2 text-[11px] leading-5 text-slate-700">
        你想让我：{agentPlan.userIntent}
      </div>
      <ul className="mt-2 space-y-1.5 text-[11px] leading-5 text-slate-700">
        {agentPlan.operations.map((operation, index) => {
          const impact = describeOperationImpact(operation);
          return (
            <li key={operation.id} className="rounded-lg bg-white px-2.5 py-2">
              <div className="flex items-start justify-between gap-2">
                <span className="font-medium text-slate-700">{index + 1}. {operation.title}</span>
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] font-semibold text-slate-500">
                  {operation.riskLevel}
                </span>
              </div>
              <p className="mt-1 text-[10px] text-slate-500">{operation.description}</p>
              <div className="mt-2 grid gap-1 text-[10px] text-slate-500 sm:grid-cols-3">
                <span className="rounded-md bg-slate-50 px-2 py-1">
                  <strong className="text-slate-600">影响范围：</strong>{impact.scope}
                </span>
                <span className="rounded-md bg-slate-50 px-2 py-1">
                  <strong className="text-slate-600">合并方式：</strong>{impact.merge}
                </span>
                <span className="rounded-md bg-slate-50 px-2 py-1">
                  <strong className="text-slate-600">旧结果：</strong>{impact.overwrite}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {(agentPlan.assumptions.length > 0 || agentPlan.warnings.length > 0) && (
        <details className="mt-2 rounded-lg bg-white px-2.5 py-2 text-[10px] leading-4 text-slate-500">
          <summary className="cursor-pointer font-medium text-slate-600">
            查看默认假设和风险提示
          </summary>
          {agentPlan.assumptions.length > 0 && (
            <p className="mt-2">
              <strong>默认：</strong>{agentPlan.assumptions.join("；")}
            </p>
          )}
          {agentPlan.warnings.length > 0 && (
            <p className="mt-2 text-amber-700">
              <strong>注意：</strong>{agentPlan.warnings.join("；")}
            </p>
          )}
        </details>
      )}
      <p className="mt-2 text-[10px] font-medium text-emerald-700">
        {agentPlan.confirmationText}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-lg px-3 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-white disabled:text-slate-300"
        >
          取消
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={loading}
          className="rounded-lg bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white disabled:bg-slate-300"
        >
          确认执行
        </button>
      </div>
    </div>
  );
}
