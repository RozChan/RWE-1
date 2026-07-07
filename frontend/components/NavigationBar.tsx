type NavigationBarProps = {
  label: string;
  count: number;
  current: number;
  inputValue: string;
  onInputChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
  onJump: () => void;
  disabled: boolean;
  compact?: boolean;
};

export function NavigationBar({
  label,
  count,
  current,
  inputValue,
  onInputChange,
  onPrevious,
  onNext,
  onJump,
  disabled,
  compact = false,
}: NavigationBarProps) {
  return (
    <div className={`flex flex-wrap items-center gap-2 text-[11px] ${compact ? "flex-1" : "rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2"}`}>
      <span className="font-semibold text-slate-700">{label}</span>
      <span className="text-slate-400">
        {current > 0 ? current : "-"}/{count}
      </span>
      <button
        type="button"
        disabled={disabled}
        onClick={onPrevious}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600 hover:border-blue-200 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
      >
        上一个
      </button>
      <button
        type="button"
        disabled={disabled}
        onClick={onNext}
        className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-600 hover:border-blue-200 hover:text-brand disabled:cursor-not-allowed disabled:opacity-40"
      >
        下一个
      </button>
      <span className="ml-auto text-slate-400">跳转到第</span>
      <input
        type="number"
        min={1}
        max={Math.max(1, count)}
        value={inputValue}
        disabled={disabled}
        onChange={(event) => onInputChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") onJump();
        }}
        className="w-14 rounded-md border border-slate-200 bg-white px-2 py-1 text-center font-semibold text-slate-700 outline-none focus:border-blue-300 disabled:bg-slate-100"
      />
      <span className="text-slate-400">个</span>
      <button
        type="button"
        disabled={disabled}
        onClick={onJump}
        className="rounded-md bg-brand px-2 py-1 font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        跳转
      </button>
    </div>
  );
}
