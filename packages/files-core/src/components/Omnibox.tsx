import * as eden from "@edenapp/client";
import type { CommandStream, FilesystemLocation } from "@edenapp/types";
import { FaSolidSpinner } from "solid-icons/fa";
import type { Component } from "solid-js";
import { createEffect, createSignal, For, on, onCleanup, Show } from "solid-js";
import { fileIcons } from "../fileIcons";
import type { Breadcrumb, FileExplorerLabels } from "../types";
import { getParentPath } from "../utils";
import FileGraphic from "./FileGraphic";

interface Suggestion {
  type: "path" | "file" | "folder";
  name: string;
  location: FilesystemLocation;
  icon: string;
}

interface OmniboxProps {
  labels: FileExplorerLabels;
  currentPath: string;
  currentVolume: string;
  breadcrumbs: Breadcrumb[];
  onNavigate: (path: string, selectedItem?: string) => void;
}

const Omnibox: Component<OmniboxProps> = (props) => {
  const [isEditing, setIsEditing] = createSignal(false);
  const [inputValue, setInputValue] = createSignal("");
  const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
  const [selectedIndex, setSelectedIndex] = createSignal(0);
  const [isLoading, setIsLoading] = createSignal(false);
  const [searched, setSearched] = createSignal(0);
  const displayPath = () =>
    `/${props.breadcrumbs
      .filter((crumb) => crumb.name !== "/")
      .map((crumb) => crumb.name)
      .join("/")}`;

  let searchSequence = 0;
  let activeSearch: CommandStream<"fs/search"> | undefined;
  const stopSearch = () => {
    searchSequence += 1;
    void activeSearch?.cancel();
    activeSearch = undefined;
    setIsLoading(false);
  };
  const closeOmnibox = () => {
    stopSearch();
    setIsEditing(false);
    setSuggestions([]);
    setInputValue("");
  };
  createEffect(on(() => props.currentVolume, closeOmnibox, { defer: true }));
  onCleanup(stopSearch);

  let inputRef: HTMLInputElement | undefined;
  let containerRef: HTMLDivElement | undefined;

  /** A leading slash searches from the typed folder; otherwise from the current folder. */
  const searchScope = (value: string) => {
    if (!value.startsWith("/")) return { path: props.currentPath, term: value };
    const parts = value.split("/").filter(Boolean);
    const folder = parts.slice(0, -1).join("/");
    return { path: folder ? `/${folder}/` : "/", term: parts.at(-1) ?? "" };
  };

  const generateSuggestions = async (value: string) => {
    stopSearch();
    const sequence = searchSequence;
    const { path, term } = searchScope(value);
    setIsLoading(true);
    setSearched(0);

    try {
      const search = await eden.fs.search(
        { volume: props.currentVolume, path },
        term,
        { limit: 10 },
      );
      if (sequence !== searchSequence) {
        await search.cancel();
        return;
      }
      activeSearch = search;
      let first = true;
      for await (const progress of search) {
        setSuggestions(
          progress.results.map((result) => ({
            ...result,
            icon:
              result.type === "folder" ? fileIcons.folder : fileIcons.document,
          })),
        );
        setSearched(progress.searched);
        setSelectedIndex((index) =>
          first ? 0 : Math.min(index, Math.max(progress.results.length - 1, 0)),
        );
        first = false;
      }
    } catch (error) {
      console.error("Error searching:", error);
      if (sequence === searchSequence) setSuggestions([]);
    } finally {
      if (sequence === searchSequence) {
        activeSearch = undefined;
        setIsLoading(false);
      }
    }
  };

  // Handle input changes with debouncing
  let debounceTimer: number | undefined;
  const handleInput = (e: InputEvent) => {
    const value = (e.target as HTMLInputElement).value;
    setInputValue(value);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      generateSuggestions(value);
    }, 150);
  };

  // Handle keyboard navigation
  const handleKeyDown = (e: KeyboardEvent) => {
    const suggestionList = suggestions();

    if (e.key === "Escape") {
      e.preventDefault();
      closeOmnibox();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (
        displayPath() !== props.currentPath &&
        inputValue().trim() === displayPath()
      ) {
        closeOmnibox();
      } else if (suggestionList.length > 0) {
        const selected = suggestionList[selectedIndex()];
        if (selected) openSuggestion(selected);
      } else if (inputValue().trim()) {
        props.onNavigate(inputValue().trim());
        closeOmnibox();
      }
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) =>
        prev < suggestionList.length - 1 ? prev + 1 : prev,
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    }
  };

  // Handle click outside
  const handleClickOutside = (e: MouseEvent) => {
    if (containerRef && !containerRef.contains(e.target as Node)) {
      closeOmnibox();
    }
  };

  createEffect(() => {
    if (isEditing()) {
      document.addEventListener("mousedown", handleClickOutside);
      inputRef?.focus();
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }

    onCleanup(() => {
      document.removeEventListener("mousedown", handleClickOutside);
      if (debounceTimer) clearTimeout(debounceTimer);
    });
  });

  const handleOmniboxClick = () => {
    setInputValue(displayPath());
    setIsEditing(true);
    // Show suggestions immediately
    if (displayPath() === props.currentPath) generateSuggestions("");
  };

  const openSuggestion = (suggestion: Suggestion) => {
    if (suggestion.type === "file") {
      // For files, navigate to parent directory and select the file
      const parentPath = getParentPath(suggestion.location.path);
      props.onNavigate(parentPath, suggestion.location.path);
    } else {
      // For folders, navigate to the folder itself
      props.onNavigate(suggestion.location.path);
    }
    closeOmnibox();
  };

  const handleOmniboxKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      handleOmniboxClick();
    }
  };

  return (
    <div class="omnibox-container" ref={containerRef}>
      <Show
        when={isEditing()}
        fallback={
          <button
            type="button"
            class="omnibox-display"
            onClick={handleOmniboxClick}
            onKeyDown={handleOmniboxKeyDown}
            aria-label={props.labels.editPath}
          >
            <div class="breadcrumb-display">
              <For each={props.breadcrumbs}>
                {(crumb, index) => (
                  <>
                    {index() > 1 && <span class="breadcrumb-separator">/</span>}
                    {crumb.name === "/" ? (
                      <span class="breadcrumb-separator">/</span>
                    ) : (
                      <span class="breadcrumb-part">{crumb.name}</span>
                    )}
                  </>
                )}
              </For>
            </div>
          </button>
        }
      >
        <div class="omnibox-input-container">
          <input
            ref={inputRef}
            type="text"
            class="omnibox-input"
            value={inputValue()}
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            placeholder={props.labels.searchPlaceholder}
          />
          <Show when={isLoading()}>
            <Show when={searched() > 0}>
              <span class="eden-text-xs eden-text-tertiary">
                {props.labels.searchedItems(searched())}
              </span>
            </Show>
            <FaSolidSpinner class="omnibox-loading" />
          </Show>
        </div>

        <Show when={suggestions().length > 0}>
          <div class="omnibox-suggestions eden-glass-strong">
            <For each={suggestions()}>
              {(suggestion, index) => (
                <button
                  type="button"
                  class={`suggestion-item ${
                    index() === selectedIndex() ? "selected" : ""
                  }`}
                  onClick={() => openSuggestion(suggestion)}
                  onMouseEnter={() => setSelectedIndex(index())}
                >
                  <span class="suggestion-icon">
                    <FileGraphic src={suggestion.icon} />
                  </span>
                  <span class="suggestion-name">{suggestion.name}</span>
                  <span class="suggestion-path">
                    {suggestion.location.path}
                  </span>
                </button>
              )}
            </For>
          </div>
        </Show>
      </Show>
    </div>
  );
};

export { Omnibox };
export default Omnibox;
