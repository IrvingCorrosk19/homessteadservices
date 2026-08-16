export function Loader({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-3">
      <span
        className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent"
        aria-hidden="true"
      />
      {label ? <span>{label}</span> : <span className="sr-only">Cargando</span>}
    </span>
  );
}
