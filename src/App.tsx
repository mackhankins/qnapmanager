import { useCallback, useEffect, useState } from "react";
import { api, type AppConfig, type LibraryItem, type ServiceError } from "./api";
import { LibraryTable } from "./components/LibraryTable";
import { ConfirmDeleteDialog, type DeleteProgress } from "./components/ConfirmDeleteDialog";
import { Settings } from "./components/Settings";
import "./App.css";

function RefreshIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg className={spinning ? "spin" : ""} width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

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
        <button className="app-title" title="Go to library" onClick={() => setView("library")}>
          QNAP Manager
        </button>
        <nav>
          <button className="icon-btn" title="Refresh library" aria-label="Refresh library"
            onClick={load} disabled={loading}>
            <RefreshIcon spinning={loading} />
          </button>
          <button className={`icon-btn ${view === "settings" ? "active" : ""}`}
            title="Settings" aria-label="Settings"
            onClick={() => setView(view === "settings" ? "library" : "settings")}>
            <GearIcon />
          </button>
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
