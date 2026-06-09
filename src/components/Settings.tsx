import { useState } from "react";
import { api, type AppConfig, type Service } from "../api";

interface Props {
  config: AppConfig;
  onSaved: () => void;
}

type TestState = "" | "ok" | "fail";

export function Settings({ config, onSaved }: Props) {
  const [sonarrUrl, setSonarrUrl] = useState(config.sonarr?.url ?? "");
  const [radarrUrl, setRadarrUrl] = useState(config.radarr?.url ?? "");
  const [sonarrKey, setSonarrKey] = useState("");
  const [radarrKey, setRadarrKey] = useState("");
  const [test, setTest] = useState<Record<Service, TestState>>({ sonarr: "", radarr: "" });
  const [saving, setSaving] = useState(false);

  async function testOne(service: Service, url: string, key: string) {
    try {
      await api.testConnection(url, key, service);
      setTest((t) => ({ ...t, [service]: "ok" }));
    } catch {
      setTest((t) => ({ ...t, [service]: "fail" }));
    }
  }

  async function save() {
    setSaving(true);
    try {
      await api.saveConfig(
        { sonarr: sonarrUrl ? { url: sonarrUrl } : null, radarr: radarrUrl ? { url: radarrUrl } : null },
        sonarrKey || undefined,
        radarrKey || undefined,
      );
      onSaved();
    } finally {
      setSaving(false);
    }
  }

  const badge = (s: TestState) => (s === "ok" ? "✓ connected" : s === "fail" ? "✗ failed" : "");

  return (
    <div className="settings">
      <h2>Settings</h2>
      <fieldset>
        <legend>Sonarr (TV)</legend>
        <input placeholder="http://host:8989" value={sonarrUrl} onChange={(e) => setSonarrUrl(e.target.value)} />
        <input placeholder="API key" type="password" value={sonarrKey} onChange={(e) => setSonarrKey(e.target.value)} />
        <button onClick={() => testOne("sonarr", sonarrUrl, sonarrKey)}>Test connection</button>
        <span className={`badge ${test.sonarr}`}>{badge(test.sonarr)}</span>
      </fieldset>
      <fieldset>
        <legend>Radarr (Movies)</legend>
        <input placeholder="http://host:7878" value={radarrUrl} onChange={(e) => setRadarrUrl(e.target.value)} />
        <input placeholder="API key" type="password" value={radarrKey} onChange={(e) => setRadarrKey(e.target.value)} />
        <button onClick={() => testOne("radarr", radarrUrl, radarrKey)}>Test connection</button>
        <span className={`badge ${test.radarr}`}>{badge(test.radarr)}</span>
      </fieldset>
      <p className="hint">Leave an API key blank to keep the existing stored key.</p>
      <button className="primary" disabled={saving} onClick={save}>Save</button>
    </div>
  );
}
