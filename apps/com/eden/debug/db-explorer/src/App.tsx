import { createSignal, createEffect, onMount, For, Show } from "solid-js";
import { createStore } from "solid-js/store";
import type { Component } from "solid-js";
import type { AppManifest } from "@edenapp/types";
import { VsDatabase, VsRefresh, VsTrash, VsEdit, VsAdd } from "solid-icons/vs";
import { FiPackage } from "solid-icons/fi";
import Modal from "./components/Modal";
import DeleteConfirmDialog from "./components/DeleteConfirmDialog";

interface KeyValueEntry {
  key: string;
  value: string;
}

interface EditModalState {
  show: boolean;
  entry: KeyValueEntry | null;
  value: string;
  error: string;
}

interface AddModalState {
  show: boolean;
  key: string;
  value: string;
  error: string;
}

const App: Component = () => {
  // Core data
  const [apps, setApps] = createSignal<AppManifest[]>([]);
  const [appIcons, setAppIcons] = createSignal<Record<string, string>>({});
  const [selectedApp, setSelectedApp] = createSignal<AppManifest | null>(null);
  const [entries, setEntries] = createSignal<KeyValueEntry[]>([]);
  
  // Loading states  
  const [loading, setLoading] = createStore({ apps: true, entries: false });
  
  // Search filters
  const [search, setSearch] = createStore({ apps: "", keys: "" });
  
  // Modal states
  const [editModal, setEditModal] = createStore<EditModalState>({
    show: false,
    entry: null,
    value: "",
    error: "",
  });
  
  const [addModal, setAddModal] = createStore<AddModalState>({
    show: false,
    key: "",
    value: "",
    error: "",
  });
  
  const [deleteDialog, setDeleteDialog] = createStore({
    show: false,
    entry: null as KeyValueEntry | null,
  });

  onMount(async () => {
    await loadApps();
  });

  const loadApps = async () => {
    try {
      setLoading("apps", true);
      const result = await window.edenAPI!.shellCommand("package/list", { showHidden: true });
      setApps(result);
      
      const icons: Record<string, string> = {};
      for (const app of result) {
        try {
          const iconResult = await window.edenAPI!.shellCommand("package/get-icon", { appId: app.id });
          if (iconResult.icon) {
            icons[app.id] = iconResult.icon;
          }
        } catch (e) {
          // Icon not available
        }
      }
      setAppIcons(icons);
    } catch (error) {
      console.error("Failed to load apps:", error);
    } finally {
      setLoading("apps", false);
    }
  };

  createEffect(() => {
    const app = selectedApp();
    if (app) {
      loadEntries(app.id);
    }
  });

  const loadEntries = async (appId: string) => {
    try {
      setLoading("entries", true);
      const result = await window.edenAPI!.shellCommand("db/list/su", { appId });
      
      const entriesData: KeyValueEntry[] = [];
      for (const key of result.keys) {
        try {
          const valueResult = await window.edenAPI!.shellCommand("db/get/su", { appId, key });
          entriesData.push({
            key,
            value: valueResult.value || "",
          });
        } catch (e) {
          entriesData.push({ key, value: "" });
        }
      }
      setEntries(entriesData);
    } catch (error) {
      console.error("Failed to load entries:", error);
      setEntries([]);
    } finally {
      setLoading("entries", false);
    }
  };

  const formatValuePreview = (value: string): string => {
    if (!value) return "(empty)";
    if (value.length > 100) return value.substring(0, 100) + "...";
    return value;
  };

  const filteredApps = () => {
    const s = search.apps.toLowerCase();
    if (!s) return apps();
    return apps().filter((app) => 
      app.name.toLowerCase().includes(s) || app.id.toLowerCase().includes(s)
    );
  };

  const filteredEntries = () => {
    const s = search.keys.toLowerCase();
    if (!s) return entries();
    return entries().filter((entry) => entry.key.toLowerCase().includes(s));
  };

  const handleSelectApp = (app: AppManifest) => {
    setSelectedApp(app);
    setSearch("keys", "");
  };

  const handleEditEntry = (entry: KeyValueEntry) => {
    setEditModal({ show: true, entry, value: entry.value || "", error: "" });
  };

  const handleSaveEdit = async () => {
    const app = selectedApp();
    if (!editModal.entry || !app) return;

    try {
      await window.edenAPI!.shellCommand("db/set/su", {
        appId: app.id,
        key: editModal.entry.key,
        value: editModal.value,
      });
      setEditModal("show", false);
      await loadEntries(app.id);
    } catch (e) {
      setEditModal("error", "Failed to save: " + (e as Error).message);
    }
  };

  const handleDeleteClick = (entry: KeyValueEntry, e: MouseEvent) => {
    e.stopPropagation();
    setDeleteDialog({ show: true, entry });
  };

  const handleConfirmDelete = async () => {
    const app = selectedApp();
    if (!deleteDialog.entry || !app) return;

    try {
      await window.edenAPI!.shellCommand("db/delete/su", {
        appId: app.id,
        key: deleteDialog.entry.key,
      });
      setDeleteDialog({ show: false, entry: null });
      await loadEntries(app.id);
    } catch (error) {
      console.error("Failed to delete:", error);
    }
  };

  const handleRefresh = () => {
    const app = selectedApp();
    if (app) loadEntries(app.id);
  };

  const handleOpenAddModal = () => {
    setAddModal({ show: true, key: "", value: "", error: "" });
  };

  const handleAddKey = async () => {
    const app = selectedApp();
    if (!app) return;

    const key = addModal.key.trim();
    if (!key) {
      setAddModal("error", "Key name is required");
      return;
    }

    try {
      await window.edenAPI!.shellCommand("db/set/su", {
        appId: app.id,
        key,
        value: addModal.value,
      });
      setAddModal("show", false);
      await loadEntries(app.id);
    } catch (e) {
      setAddModal("error", "Failed to add: " + (e as Error).message);
    }
  };

  return (
    <div class="db-explorer">
      {/* Sidebar - App List */}
      <aside class="eden-sidebar">
        <div class="eden-sidebar-header">
          <h2 class="eden-sidebar-header-title">Applications</h2>
          <input
            type="text"
            class="eden-sidebar-search"
            placeholder="Filter apps..."
            value={search.apps}
            onInput={(e) => setSearch("apps", e.currentTarget.value)}
          />
        </div>
        <div class="eden-sidebar-section eden-sidebar-section-scrollable">
          <div class="eden-sidebar-items eden-sidebar-items-scrollable">
            <Show when={!loading.apps} fallback={<div class="loading-state">Loading...</div>}>
              <For each={filteredApps()}>
                {(app) => (
                  <div
                    class={`eden-sidebar-item ${selectedApp()?.id === app.id ? "eden-sidebar-item-selected" : ""}`}
                    onClick={() => handleSelectApp(app)}
                  >
                    <Show
                      when={appIcons()[app.id]}
                      fallback={<div class="eden-sidebar-item-icon eden-sidebar-item-icon-lg"><FiPackage /></div>}
                    >
                      <div class="eden-sidebar-item-icon eden-sidebar-item-icon-lg">
                        <img src={appIcons()[app.id]} alt="" />
                      </div>
                    </Show>
                    <div class="eden-sidebar-item-details">
                      <div class="eden-sidebar-item-title">{app.name}</div>
                      <div class="eden-sidebar-item-subtitle">{app.id}</div>
                    </div>
                  </div>
                )}
              </For>
            </Show>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main class="main-content">
        <Show
          when={selectedApp()}
          fallback={
            <div class="no-app-selected">
              <div class="empty-icon"><VsDatabase /></div>
              <div class="empty-title">No App Selected</div>
              <div class="empty-subtitle">Select an application from the sidebar to view its database</div>
            </div>
          }
        >
          {(app) => (
            <>
              <header class="content-header">
                <div class="content-header-left">
                  <div>
                    <div class="content-title">{app().name}</div>
                    <div class="content-subtitle">{app().id}</div>
                  </div>
                </div>
                <div class="content-header-right">
                  <input
                    type="text"
                    class="key-search"
                    placeholder="Search keys..."
                    value={search.keys}
                    onInput={(e) => setSearch("keys", e.currentTarget.value)}
                  />
                  <button class="eden-btn eden-btn-ghost" onClick={handleRefresh}>
                    <VsRefresh />
                  </button>
                  <button class="eden-btn eden-btn-primary" onClick={handleOpenAddModal}>
                    <VsAdd /> Add Key
                  </button>
                </div>
              </header>

              <div class="kv-table-container eden-card-glass">
                <Show
                  when={!loading.entries}
                  fallback={<div class="loading-state"><span class="loading-spinner">⟳</span> Loading entries...</div>}
                >
                  <Show
                    when={filteredEntries().length > 0}
                    fallback={
                      <div class="empty-state">
                        <div class="empty-icon"><VsDatabase /></div>
                        <div class="empty-title">No Data</div>
                        <div class="empty-subtitle">This application has no stored data</div>
                      </div>
                    }
                  >
                    <table class="kv-table">
                      <thead>
                        <tr>
                          <th>Key</th>
                          <th>Value</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        <For each={filteredEntries()}>
                          {(entry) => (
                            <tr onClick={() => handleEditEntry(entry)}>
                              <td class="kv-key">{entry.key}</td>
                              <td class="kv-value">{formatValuePreview(entry.value)}</td>
                              <td class="kv-actions">
                                <button class="action-btn" onClick={(e) => { e.stopPropagation(); handleEditEntry(entry); }}>
                                  <VsEdit />
                                </button>
                                <button class="action-btn delete" onClick={(e) => handleDeleteClick(entry, e)}>
                                  <VsTrash />
                                </button>
                              </td>
                            </tr>
                          )}
                        </For>
                      </tbody>
                    </table>
                  </Show>
                </Show>
              </div>
            </>
          )}
        </Show>
      </main>

      {/* Edit Modal */}
      <Modal
        show={editModal.show}
        onClose={() => setEditModal("show", false)}
        title="Edit Value"
        size="lg"
        footer={
          <>
            <button class="eden-btn eden-btn-ghost" onClick={() => setEditModal("show", false)}>Cancel</button>
            <button class="eden-btn eden-btn-primary" onClick={handleSaveEdit}>Save</button>
          </>
        }
      >
        <div class="value-editor">
          <div class="value-editor-key">{editModal.entry?.key}</div>
          <Show when={editModal.error}>
            <div class="value-editor-error">{editModal.error}</div>
          </Show>
          <textarea
            class="value-editor-textarea"
            value={editModal.value}
            onInput={(e) => setEditModal("value", e.currentTarget.value)}
          />
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <DeleteConfirmDialog
        show={deleteDialog.show}
        onClose={() => setDeleteDialog("show", false)}
        onConfirm={handleConfirmDelete}
        keyName={deleteDialog.entry?.key || ""}
      />

      {/* Add Key Modal */}
      <Modal
        show={addModal.show}
        onClose={() => setAddModal("show", false)}
        title="Add New Key"
        size="lg"
        footer={
          <>
            <button class="eden-btn eden-btn-ghost" onClick={() => setAddModal("show", false)}>Cancel</button>
            <button class="eden-btn eden-btn-primary" onClick={handleAddKey}>Add</button>
          </>
        }
      >
        <div class="value-editor">
          <Show when={addModal.error}>
            <div class="value-editor-error">{addModal.error}</div>
          </Show>
          <div class="add-key-field">
            <label class="add-key-label">Key Name</label>
            <input
              type="text"
              class="add-key-input"
              placeholder="Enter key name..."
              value={addModal.key}
              onInput={(e) => setAddModal("key", e.currentTarget.value)}
            />
          </div>
          <div class="add-key-field">
            <label class="add-key-label">Value</label>
            <textarea
              class="value-editor-textarea"
              placeholder="Enter value..."
              value={addModal.value}
              onInput={(e) => setAddModal("value", e.currentTarget.value)}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default App;
