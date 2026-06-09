import type { LibraryItem } from "../api";
import { formatBytes } from "../lib/format";

interface Props {
  items: LibraryItem[];
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteDialog({ items, onCancel, onConfirm }: Props) {
  const total = items.reduce((sum, it) => sum + it.size_on_disk, 0);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal">
        <h2>Delete {items.length} item{items.length === 1 ? "" : "s"}?</h2>
        <p>This permanently deletes the files and the library entries. This cannot be undone.</p>
        <ul className="delete-list">
          {items.map((it) => (
            <li key={`${it.service}-${it.id}`}>
              <span>{it.title}</span>
              <span className="muted">{it.service === "sonarr" ? "TV" : "Movie"} · {formatBytes(it.size_on_disk)}</span>
            </li>
          ))}
        </ul>
        <p className="total">Reclaims <strong>{formatBytes(total)}</strong></p>
        <div className="modal-actions">
          <button onClick={onCancel}>Cancel</button>
          <button className="danger" onClick={onConfirm}>
            Delete {items.length} item{items.length === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
