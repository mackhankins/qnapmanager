import type { LibraryItem } from "../api";
import { formatBytes } from "../lib/format";

export interface DeleteProgress {
  done: number; // items fully processed so far
  total: number;
  current: string; // title of the item currently being deleted
}

interface Props {
  items: LibraryItem[];
  onCancel: () => void;
  onConfirm: () => void;
  /** When set, the dialog shows live deletion progress instead of the confirm buttons. */
  progress?: DeleteProgress | null;
}

export function ConfirmDeleteDialog({ items, onCancel, onConfirm, progress }: Props) {
  const total = items.reduce((sum, it) => sum + it.size_on_disk, 0);
  const busy = !!progress;
  const pct = progress ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Delete {items.length} item{items.length === 1 ? "" : "s"}?</h2>
        <p>This permanently deletes the files and the library entries. This cannot be undone.</p>
        <ul className="delete-list">
          {items.map((it, i) => {
            const state = !progress ? "" : i < progress.done ? "done" : i === progress.done ? "active" : "pending";
            return (
              <li key={`${it.service}-${it.id}`} className={`del-${state}`}>
                <span>
                  {busy && <span className="del-mark">{state === "done" ? "✓" : state === "active" ? "…" : "•"}</span>}
                  {it.title}
                </span>
                <span className="muted">{it.service === "sonarr" ? "TV" : "Movie"} · {formatBytes(it.size_on_disk)}</span>
              </li>
            );
          })}
        </ul>

        {progress ? (
          <div className="delete-progress" aria-live="polite">
            <div className="progress"><div className="progress-bar" style={{ width: `${pct}%` }} /></div>
            <p className="muted">
              {progress.total === 1
                ? `Deleting ${progress.current}…`
                : `Deleting ${Math.min(progress.done + 1, progress.total)} of ${progress.total} — ${progress.current}…`}
            </p>
          </div>
        ) : (
          <>
            <p className="total">Reclaims <strong>{formatBytes(total)}</strong></p>
            <div className="modal-actions">
              <button onClick={onCancel}>Cancel</button>
              <button className="danger" onClick={onConfirm}>
                Delete {items.length} item{items.length === 1 ? "" : "s"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
