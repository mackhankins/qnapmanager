import { useCallback, useEffect, useState } from "react";
import { api, type AppConfig, type LibraryItem, type ServiceError } from "./api";
import { LibraryTable } from "./components/LibraryTable";
import { ConfirmDeleteDialog, type DeleteProgress } from "./components/ConfirmDeleteDialog";
import { Settings } from "./components/Settings";
import "./App.css";

type View = "library" | "settings";

export default function App() {
  const [view, setView] = useState<View>("library");
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [errors, setErrors] = useState<ServiceError[]>([]);
  const [loading, setLoading] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<LibraryItem[] | null>(null);
  const [deleteProgress, setDeleteProgress] = useState<DeleteProgress | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.listLibrary();
      setItems(res.items);
      setErrors(res.errors);
    } catch (e) {
      setErrors([{ service: "App", message: String((e as { message?: string }).message ?? e) }]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    api.getConfig().then(setConfig);
    load();
  }, [load]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    const targets = pendingDelete;
    const failures: { title: string; message: string }[] = [];
    // Delete one at a time so we can show live per-item progress.
    for (let i = 0; i < targets.length; i++) {
      setDeleteProgress({ done: i, total: targets.length, current: targets[i].title });
      try {
        await api.deleteItem(targets[i]);
      } catch (e) {
        failures.push({ title: targets[i].title, message: String((e as { message?: string }).message ?? e) });
      }
    }
    setDeleteProgress(null);
    setPendingDelete(null);
    if (failures.length > 0) {
      setErrors(failures.map((f) => ({ service: "Delete", message: `${f.title}: ${f.message}` })));
    }
    await load();
  }

  async function toggleTag(item: LibraryItem) {
    try {
      await api.toggleTemporaryTag(item);
    } catch (e) {
      setErrors([{ service: "Tag", message: String((e as { message?: string }).message ?? e) }]);
    }
    await load();
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>QNAP Manager</h1>
        <nav>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}>Library</button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>Settings</button>
          <button onClick={load} disabled={loading}>{loading ? "Refreshing…" : "Refresh"}</button>
        </nav>
      </header>

      {errors.map((e) => (
        <div key={e.service} className="error-banner">{e.service}: {e.message}</div>
      ))}

      {view === "settings" && config && (
        <Settings config={config} onSaved={() => { api.getConfig().then(setConfig); setView("library"); load(); }} />
      )}

      {view === "library" && (
        <LibraryTable
          items={items}
          onDelete={(item) => setPendingDelete([item])}
          onBulkDelete={(sel) => setPendingDelete(sel)}
          onToggleTag={toggleTag}
        />
      )}

      {pendingDelete && (
        <ConfirmDeleteDialog
          items={pendingDelete}
          progress={deleteProgress}
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
