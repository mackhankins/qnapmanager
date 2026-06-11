import { invoke } from "@tauri-apps/api/core";

export type Service = "sonarr" | "radarr";

export interface LibraryItem {
  id: number;
  title: string;
  service: Service;
  size_on_disk: number;
  status: string | null;
  added: string | null;
  tags: number[];
  tag_labels: string[];
}

export interface ServiceConfig { url: string }
export interface AppConfig { sonarr: ServiceConfig | null; radarr: ServiceConfig | null }
export interface ServiceError { service: string; message: string }
export interface LoadResult { items: LibraryItem[]; errors: ServiceError[] }

export const api = {
  getConfig: () => invoke<AppConfig>("get_config"),
  saveConfig: (config_in: AppConfig, sonarr_key?: string, radarr_key?: string) =>
    invoke<void>("save_config", { configIn: config_in, sonarrKey: sonarr_key, radarrKey: radarr_key }),
  testConnection: (url: string, api_key: string, service: Service) =>
    invoke<void>("test_connection", { url, apiKey: api_key, service }),
  listLibrary: () => invoke<LoadResult>("list_library"),
  toggleTemporaryTag: (item: LibraryItem) => invoke<void>("toggle_temporary_tag", { item }),
  deleteItem: (item: LibraryItem) => invoke<void>("delete_item", { item }),
};

export const isTemporary = (item: LibraryItem): boolean =>
  item.tag_labels.some((l) => l.toLowerCase() === "temporary");
