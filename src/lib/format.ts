const UNITS = ["B", "KB", "MB", "GB", "TB"];

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log10(bytes) / 3));
  const value = bytes / Math.pow(1000, i);
  const rounded = i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${UNITS[i]}`;
}

export function ageDays(added: string | null, now: number): number | null {
  if (!added) return null;
  const ms = now - new Date(added).getTime();
  return Math.floor(ms / 86_400_000);
}

export function formatAge(added: string | null, now: number): string {
  const d = ageDays(added, now);
  return d == null ? "—" : `${d}d`;
}

// Friendly labels for the *arr `status` field (Sonarr series + Radarr movies).
const STATUS_LABELS: Record<string, string> = {
  continuing: "Continuing",
  ended: "Ended",
  upcoming: "Upcoming",
  deleted: "Deleted",
  tba: "TBA",
  announced: "Announced",
  inCinemas: "In Cinemas",
  released: "Released",
};

export function formatStatus(status: string | null): string {
  if (!status) return "—";
  return STATUS_LABELS[status] ?? status;
}
