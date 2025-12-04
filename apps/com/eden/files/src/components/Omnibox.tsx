import { createSignal, createEffect, onCleanup, For, Show } from "solid-js";
import type { Component } from "solid-js";

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
    onNavigate: (path: string) => void;
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
        if (!value || value.trim() === "") {
            setSuggestions([]);
            return;
        }

        setIsLoading(true);
        const newSuggestions: Suggestion[] = [];

        try {
            // If it looks like a path (starts with /)
            if (value.startsWith("/")) {
                const pathParts = value.split("/").filter((p) => p);
                let basePath = "/";

                if (pathParts.length > 0) {
                    basePath = "/" + pathParts.slice(0, -1).join("/");
                    if (basePath !== "/") basePath += "/";
                }

                const searchTerm = pathParts[pathParts.length - 1]?.toLowerCase() || "";

                try {
                    const items = await (window as any).edenAPI.shellCommand("fs/readdir", {
                        path: basePath === "//" ? "/" : basePath,
                    });

                    for (const item of items) {
                        if (searchTerm === "" || item.toLowerCase().includes(searchTerm)) {
                            const itemPath = basePath + item;
                            try {
                                const stats = await (window as any).edenAPI.shellCommand("fs/stat", {
                                    path: itemPath,
                                });

                                newSuggestions.push({
                                    type: stats.isDirectory ? "folder" : "file",
                                    name: item,
                                    path: itemPath,
                                    icon: stats.isDirectory ? "📁" : "📄",
                                });

                                if (newSuggestions.length >= 10) break;
                            } catch (error) {
                                // Skip items we can't stat
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error reading directory:", error);
                }
            } else {
                // Search in current directory
                const searchTerm = value.toLowerCase();
                try {
                    const items = await (window as any).edenAPI.shellCommand("fs/readdir", {
                        path: props.currentPath,
                    });

                    for (const item of items) {
                        if (item.toLowerCase().includes(searchTerm)) {
                            const itemPath =
                                props.currentPath === "/"
                                    ? "/" + item
                                    : props.currentPath + "/" + item;

                            try {
                                const stats = await (window as any).edenAPI.shellCommand("fs/stat", {
                                    path: itemPath,
                                });

                                newSuggestions.push({
                                    type: stats.isDirectory ? "folder" : "file",
                                    name: item,
                                    path: itemPath,
                                    icon: stats.isDirectory ? "📁" : "📄",
                                });

                                if (newSuggestions.length >= 10) break;
                            } catch (error) {
                                // Skip items we can't stat
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error searching:", error);
                }
            }

            setSuggestions(newSuggestions);
            setSelectedIndex(0);
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
    };

    const handleSuggestionClick = (suggestion: Suggestion) => {
        props.onNavigate(suggestion.path);
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
