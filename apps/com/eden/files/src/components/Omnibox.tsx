import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import type { Component } from "solid-js";
import { getParentPath } from "../utils";

interface Breadcrumb {
    name: string;
    path: string;
}

interface Suggestion {
    type: "path" | "file" | "folder";
    name: string;
    path: string;
    icon: string;
}

interface OmniboxProps {
    currentPath: string;
    breadcrumbs: Breadcrumb[];
    onNavigate: (path: string, selectedItem?: string) => void;
}

const Omnibox: Component<OmniboxProps> = (props) => {
    const [isEditing, setIsEditing] = createSignal(false);
    const [inputValue, setInputValue] = createSignal("");
    const [suggestions, setSuggestions] = createSignal<Suggestion[]>([]);
    const [selectedIndex, setSelectedIndex] = createSignal(0);
    const [isLoading, setIsLoading] = createSignal(false);

    let inputRef: HTMLInputElement | undefined;
    let containerRef: HTMLDivElement | undefined;

    // Generate suggestions based on input
    const generateSuggestions = async (value: string) => {
        setIsLoading(true);

        try {
            // If it looks like a path (starts with /)
            if (value.startsWith("/")) {
                const pathParts = value.split("/").filter((p) => p);
                let basePath = "/";
                let searchTerm = "";

                if (pathParts.length > 0) {
                    basePath = "/" + pathParts.slice(0, -1).join("/");
                    if (basePath !== "/") basePath += "/";
                    searchTerm = pathParts[pathParts.length - 1]?.toLowerCase() || "";
                }

                const results = await window.edenAPI!.shellCommand("fs/search", {
                    path: basePath === "//" ? "/" : basePath,
                    pattern: searchTerm,
                    limit: 10,
                });

                // Add icons on frontend based on type
                const resultsWithIcons = results.map((r) => ({
                    ...r,
                    icon: r.type === "folder" ? "📁" : "📄",
                }));

                setSuggestions(resultsWithIcons);
                setSelectedIndex(0);
            } else {
                // Search in current directory (empty value shows all items)
                const results = await window.edenAPI!.shellCommand("fs/search", {
                    path: props.currentPath,
                    pattern: value.toLowerCase(),
                    limit: 10,
                });

                // Add icons on frontend based on type
                const resultsWithIcons = results.map((r) => ({
                    ...r,
                    icon: r.type === "folder" ? "📁" : "📄",
                }));

                setSuggestions(resultsWithIcons);
                setSelectedIndex(0);
            }
        } catch (error) {
            console.error("Error searching:", error);
            setSuggestions([]);
        } finally {
            setIsLoading(false);
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
            setIsEditing(false);
            setSuggestions([]);
            setInputValue("");
        } else if (e.key === "Enter") {
            e.preventDefault();
            if (suggestionList.length > 0) {
                const selected = suggestionList[selectedIndex()];
                if (selected) {
                    props.onNavigate(selected.path);
                    setIsEditing(false);
                    setSuggestions([]);
                    setInputValue("");
                }
            } else if (inputValue().trim()) {
                // Navigate to entered path
                props.onNavigate(inputValue().trim());
                setIsEditing(false);
                setSuggestions([]);
                setInputValue("");
            }
        } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setSelectedIndex((prev) =>
                prev < suggestionList.length - 1 ? prev + 1 : prev
            );
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
        }
    };

    // Handle click outside
    const handleClickOutside = (e: MouseEvent) => {
        if (containerRef && !containerRef.contains(e.target as Node)) {
            setIsEditing(false);
            setSuggestions([]);
            setInputValue("");
        }
    };

    createEffect(() => {
        if (isEditing()) {
            document.addEventListener("mousedown", handleClickOutside);
            inputRef?.focus();
            setInputValue(props.currentPath);
        } else {
            document.removeEventListener("mousedown", handleClickOutside);
        }

        onCleanup(() => {
            document.removeEventListener("mousedown", handleClickOutside);
            if (debounceTimer) clearTimeout(debounceTimer);
        });
    });

    const handleOmniboxClick = () => {
        setIsEditing(true);
        // Show suggestions immediately
        generateSuggestions("");
    };

    const handleSuggestionClick = (suggestion: Suggestion) => {
        if (suggestion.type === "file") {
            // For files, navigate to parent directory and select the file
            const parentPath = getParentPath(suggestion.path);
            props.onNavigate(parentPath, suggestion.path);
        } else {
            // For folders, navigate to the folder itself
            props.onNavigate(suggestion.path);
        }
        setIsEditing(false);
        setSuggestions([]);
        setInputValue("");
    };

    return (
        <div class="omnibox-container" ref={containerRef}>
            <Show
                when={isEditing()}
                fallback={
                    <div class="omnibox-display" onClick={handleOmniboxClick}>
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
                    </div>
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
                        placeholder="Type a path or search..."
                    />
                    {isLoading() && <span class="omnibox-loading">⏳</span>}
                </div>

                <Show when={suggestions().length > 0}>
                    <div class="omnibox-suggestions eden-glass-strong">
                        <For each={suggestions()}>
                            {(suggestion, index) => (
                                <div
                                    class={`suggestion-item ${index() === selectedIndex() ? "selected" : ""
                                        }`}
                                    onClick={() => handleSuggestionClick(suggestion)}
                                    onMouseEnter={() => setSelectedIndex(index())}
                                >
                                    <span class="suggestion-icon">{suggestion.icon}</span>
                                    <span class="suggestion-name">{suggestion.name}</span>
                                    <span class="suggestion-path">{suggestion.path}</span>
                                </div>
                            )}
                        </For>
                    </div>
                </Show>
            </Show>
        </div>
    );
};

export default Omnibox;
