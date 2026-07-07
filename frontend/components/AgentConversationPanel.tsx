import type { FormEvent } from "react";
import { AgentPlanCard } from "@/components/AgentPlanCard";
import { Icon } from "@/components/icons";
import { Panel } from "@/components/PagePrimitives";
import type { AgentExecution, AgentMessage, AgentPlan } from "@/lib/types";

const agentExamples = [
  "新增一个商业价值维度，识别收入、成本、效率和客户价值，然后只用这个维度分析全文，结果追加不覆盖。",
  "按当前所有维度重新分析全文。",
  "导出 Word",
  "把风险问题维度关掉",
];

type AgentConversationPanelProps = {
  agentMessages: AgentMessage[];
  agentExecutions: AgentExecution[];
  pendingAgentPlan: AgentPlan | null;
  agentLoading: boolean;
  agentError: string;
  agentMessage: string;
  onClear: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onChangeMessage: (value: string) => void;
  onCancelAgentPlan: () => void;
  onConfirmAgentPlan: () => void;
  onExampleClick: (value: string) => void;
};

export function AgentConversationPanel({
  agentMessages,
  agentExecutions,
  pendingAgentPlan,
  agentLoading,
  agentError,
  agentMessage,
  onClear,
  onSubmit,
  onChangeMessage,
  onCancelAgentPlan,
  onConfirmAgentPlan,
  onExampleClick,
}: AgentConversationPanelProps) {
  return (
    <div data-testid="agent-panel">
      <Panel
        title="AI Agent"
        icon="robot"
        action={
          <button
            type="button"
            onClick={onClear}
            className="flex items-center gap-1 text-[11px] text-slate-500"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
            清空对话
          </button>
        }
      >
        <div className="flex h-[690px] flex-col">
        <div className="scrollbar flex-1 space-y-4 overflow-y-auto p-4">
          {agentMessages.map((item) => {
            const execution = item.executionId
              ? agentExecutions.find((entry) => entry.id === item.executionId)
              : null;
            return (
              <div key={item.id} className="space-y-2">
                <div className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[90%] whitespace-pre-line rounded-2xl px-3.5 py-3 text-xs leading-5 ${
                      item.role === "user"
                        ? "rounded-br-md bg-emerald-100 text-emerald-800"
                        : item.messageKind === "error"
                          ? "rounded-bl-md bg-rose-50 text-rose-700"
                          : "rounded-bl-md bg-slate-100 text-slate-700"
                    }`}
                  >
                    {item.content}
                  </div>
                </div>
                {execution && (
                  <div className="max-w-[90%] rounded-xl border border-slate-200 bg-white p-3">
                    <p className="text-xs font-bold text-slate-700">
                      {execution.status === "succeeded"
                        ? "已完成"
                        : execution.status === "failed" || execution.status === "partially_succeeded"
                          ? "执行遇到问题"
                          : "执行中"}
                    </p>
                    <details className="mt-2 text-[11px] text-slate-500">
                      <summary className="cursor-pointer font-medium">查看详情</summary>
                      <ul className="mt-2 space-y-1 text-slate-600">
                        {execution.operationResults.map((result) => (
                          <li key={result.operationId} className="flex items-start gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                            <span>{result.status === "succeeded" ? "✅" : result.status === "failed" ? "❌" : result.status === "running" ? "⏳" : "○"}</span>
                            <span className="whitespace-pre-line">
                              {(result.details?.length ? result.details : [result.message]).join("\n")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  </div>
                )}
              </div>
            );
          })}
          {pendingAgentPlan && (
            <AgentPlanCard
              plan={pendingAgentPlan}
              loading={agentLoading}
              onCancel={onCancelAgentPlan}
              onConfirm={onConfirmAgentPlan}
            />
          )}
          {agentLoading && (
            <div className="flex justify-start">
              <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3.5 py-3 text-xs text-slate-500">
                Agent 正在规划…
              </div>
            </div>
          )}
        </div>
        <form onSubmit={onSubmit} className="border-t border-slate-100 p-3">
          <div className="rounded-xl border border-slate-200 p-2 focus-within:border-brand focus-within:ring-4 focus-within:ring-blue-50">
            <textarea
              value={agentMessage}
              maxLength={1000}
              onChange={(event) => onChangeMessage(event.target.value)}
              placeholder="例如：新增商业价值维度并只用它分析全文，结果追加不覆盖"
              className="h-20 w-full resize-none border-0 px-1 text-xs leading-5 outline-none"
            />
            <div className="flex items-end justify-between">
              <span className="text-[10px] text-slate-400">{agentMessage.length}/1000</span>
              <button
                type="submit"
                disabled={!agentMessage.trim() || agentLoading}
                className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-white shadow-sm disabled:bg-slate-300"
              >
                <Icon name="send" className="h-4 w-4" />
              </button>
            </div>
          </div>
        </form>
        <div className="px-3 pb-3">
          {agentError && (
            <p className="mb-2 rounded-lg bg-rose-50 px-3 py-2 text-[11px] text-rose-700">
              {agentError}
            </p>
          )}
          <p className="mb-2 text-[11px] font-semibold text-slate-500">Agent 示例</p>
          <div className="flex flex-wrap gap-1.5">
            {agentExamples.map((label) => (
              <button
                type="button"
                onClick={() => onExampleClick(label)}
                key={label}
                className="rounded-md bg-slate-100 px-2 py-1 text-[10px] text-slate-600 hover:bg-blue-50 hover:text-brand"
              >
                {label.length > 28 ? `${label.slice(0, 28)}…` : label}
              </button>
            ))}
          </div>
        </div>
        </div>
      </Panel>
    </div>
  );
}
