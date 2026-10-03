import {
  controlDisplayClass,
  controlDisplayLabel,
  type ControlDisplayState,
} from "@/lib/control-status";

export function ControlDisplayPill({ state }: { state: ControlDisplayState }) {
  return (
    <span
      className={`inline-flex max-w-full items-center rounded-full border px-3 py-1 text-[0.68rem] font-semibold tracking-[0.08em] uppercase ${controlDisplayClass(state)}`}
    >
      {controlDisplayLabel(state)}
    </span>
  );
}
