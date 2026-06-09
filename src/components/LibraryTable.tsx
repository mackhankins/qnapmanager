import { useMemo, useState } from "react";
import {
  useReactTable, getCoreRowModel, getSortedRowModel, flexRender,
  type ColumnDef, type SortingState, type RowSelectionState,
} from "@tanstack/react-table";
import type { LibraryItem } from "../api";
import { isTemporary } from "../api";
import { formatBytes, formatAge } from "../lib/format";

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
  const [sorting, setSorting] = useState<SortingState>([{ id: "size_on_disk", desc: true }]);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const now = Date.now();

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filter === "sonarr" && it.service !== "sonarr") return false;
      if (filter === "radarr" && it.service !== "radarr") return false;
      if (filter === "temporary" && !isTemporary(it)) return false;
      if (search && !it.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, search]);

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
      cell: (c) => (c.getValue() === "sonarr" ? "TV" : "Film") },
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
    getRowId: (row) => String(row.id),
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
                <button onClick={() => onToggleTag(row.original)}>
                  {isTemporary(row.original) ? "Untag" : "Tag temp"}
                </button>
                <button onClick={() => onDelete(row.original)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
