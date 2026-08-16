import type { ServiceSlug } from "@/lib/site";

const icons: Record<ServiceSlug, string> = {
  ac: "M4 10.5h16M6 10.5V8a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M8 14h.01M12 14h.01M16 14h.01M7 18h10",
  plumbing: "M8 4v6a4 4 0 0 0 8 0V4M12 14v6M9 20h6",
  painting: "M5 20h6l1-9H4l1 9ZM12 7V4h8v4c0 2-2 3-4 3h-1",
  electrical: "M13 2 6 13h6l-1 9 8-12h-6l0-8Z",
  locksmith: "M8 11V8a4 4 0 0 1 8 0v3M7 11h10v10H7V11Zm5 4v3",
  repairs: "M14.7 6.3a4 4 0 0 1-5.6 5.6L4 17l3 3 5.1-5.1a4 4 0 0 1 5.6-5.6l-3-3Z",
  remodeling: "M4 20V9l8-5 8 5v11M9 20v-7h6v7",
};

export function ServiceIcon({
  slug,
  className = "h-6 w-6",
}: {
  slug: ServiceSlug;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={icons[slug]} />
    </svg>
  );
}
