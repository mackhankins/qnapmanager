import { useCallback, useEffect, useState } from "react";
import { api, type AppConfig, type LibraryItem, type ServiceError } from "./api";
import { LibraryTable } from "./components/LibraryTable";
import { ConfirmDeleteDialog } from "./components/ConfirmDeleteDialog";
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
    if (pendingDelete.length === 1) {
      await api.deleteItem(pendingDelete[0]);
    } else {
      await api.bulkDelete(pendingDelete);
    }
    setPendingDelete(null);
    await load();
  }

  async function toggleTag(item: LibraryItem) {
    await api.toggleTemporaryTag(item);
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
        <Settings config={config} onSaved={() => { setView("library"); load(); }} />
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
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
