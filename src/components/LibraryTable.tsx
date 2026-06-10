import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState, type RowSelectionState,
} from "@tanstack/react-table";
import type { LibraryItem } from "../api";
import { isTemporary } from "../api";
import { formatBytes, formatAge, formatStatus } from "../lib/format";

function TagIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"}
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" />
      <circle cx="7.5" cy="7.5" r="1.1" fill={filled ? "#fff" : "currentColor"} stroke="none" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

type Filter = "all" | "sonarr" | "radarr" | "temporary";

interface Props {
  items: LibraryItem[];
  onDelete: (item: LibraryItem) => void;
  onToggleTag: (item: LibraryItem) => void;
  onBulkDelete: (items: LibraryItem[]) => void;
}

export function LibraryTable({ items, onDelete, onToggleTag, onBulkDelete }: Props) {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([{ id: "size_on_disk", desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const now = Date.now();

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter === "sonarr" && it.service !== "sonarr") return false;
      if (filter === "radarr" && it.service !== "radarr") return false;
      if (filter === "temporary" && !isTemporary(it)) return false;
      if (statusFilter && it.status !== statusFilter) return false;
      if (search && !it.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, search, statusFilter]);

  // Distinct statuses present in the library, cleanup-relevant ones first.
  const statusOptions = useMemo(() => {
    const present = [...new Set(items.map((it) => it.status).filter((s): s is string => !!s))];
    const order = ["ended", "continuing", "upcoming", "released", "inCinemas", "announced", "tba", "deleted"];
    const rank = (s: string) => (order.indexOf(s) === -1 ? order.length : order.indexOf(s));
    return present.sort((a, b) => rank(a) - rank(b));
  }, [items]);

  const columns = useMemo<ColumnDef<LibraryItem>[]>(() => [
    {
      id: "select",
      header: ({ table }) => (
        <input type="checkbox" aria-label="Select all"
          checked={table.getIsAllRowsSelected()}
          onChange={table.getToggleAllRowsSelectedHandler()} />
      ),
      cell: ({ row }) => (
        <input type="checkbox" aria-label={`Select ${row.original.title}`}
          checked={row.getIsSelected()} onChange={row.getToggleSelectedHandler()} />
      ),
    },
    { accessorKey: "title", header: "Title" },
    { accessorKey: "service", header: "Type",
      cell: (c) => (c.getValue() === "sonarr" ? "TV" : "Movie") },
    { accessorKey: "status", header: "Status",
      cell: (c) => {
        const s = c.getValue() as string | null;
        return s ? <span className={`status-badge status-${s}`}>{formatStatus(s)}</span> : "—";
      } },
    { id: "tags", header: "Tags",
      cell: ({ row }) => row.original.tag_labels.join(", ") || "—" },
    { accessorKey: "added", header: "Date Added",
      cell: (c) => (c.getValue() ? String(c.getValue()).slice(0, 10) : "—") },
    { id: "age", header: "Age", accessorFn: (r) => r.added,
      cell: ({ row }) => formatAge(row.original.added, now),
      sortingFn: (a, b) => {
        const av = a.original.added ? new Date(a.original.added).getTime() : Infinity;
        const bv = b.original.added ? new Date(b.original.added).getTime() : Infinity;
        return av - bv;
      } },
    { accessorKey: "size_on_disk", header: "Size",
      cell: (c) => formatBytes(c.getValue() as number) },
  ], [now]);

  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getRowId: (row) => `${row.service}-${row.id}`,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selected = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedSize = selected.reduce((sum, it) => sum + it.size_on_disk, 0);

  const chips: Filter[] = ["all", "sonarr", "radarr", "temporary"];
  const chipLabel: Record<Filter, string> = {
    all: "All", sonarr: "TV", radarr: "Movies", temporary: "temporary",
  };

  return (
    <div className="library">
      <div className="toolbar">
        <input className="search" placeholder="Search title…"
          value={search} onChange={(e) => setSearch(e.target.value)} />
        {chips.map((c) => (
          <button key={c} className={`chip ${filter === c ? "active" : ""}`}
            onClick={() => setFilter(c)}>{chipLabel[c]}</button>
        ))}
        <select className="status-filter" aria-label="Filter by status"
          value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Any status</option>
          {statusOptions.map((s) => (
            <option key={s} value={s}>{formatStatus(s)}</option>
          ))}
        </select>
      </div>

      {selected.length > 0 && (
        <div className="selection-bar">
          <span>{selected.length} selected · {formatBytes(selectedSize)}</span>
          <button onClick={() => onBulkDelete(selected)}>Delete selected</button>
        </div>
      )}

      <table>
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id} onClick={h.column.getToggleSortingHandler()}>
                  {flexRender(h.column.columnDef.header, h.getContext())}
                  {{ asc: " ▲", desc: " ▼" }[h.column.getIsSorted() as string] ?? ""}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className={row.getIsSelected() ? "selected" : ""}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>
              ))}
              <td className="row-actions">
                <button
                  className={`icon-btn ${isTemporary(row.original) ? "active" : ""}`}
                  title={isTemporary(row.original) ? "Remove temporary tag" : "Tag as temporary"}
                  aria-label={isTemporary(row.original) ? "Remove temporary tag" : "Tag as temporary"}
                  onClick={() => onToggleTag(row.original)}>
                  <TagIcon filled={isTemporary(row.original)} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete"
                  aria-label={`Delete ${row.original.title}`}
                  onClick={() => onDelete(row.original)}>
                  <TrashIcon />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
