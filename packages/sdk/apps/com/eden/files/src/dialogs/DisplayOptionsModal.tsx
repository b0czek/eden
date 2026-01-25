import { Show } from "solid-js";
import { t } from "../i18n";
import type { Component } from "solid-js";
import type { DisplayPreferences, ViewStyle, ItemSize, SortBy, SortOrder } from "../types";
import { ITEM_SIZES } from "../constants";
import { FaSolidGrip, FaSolidList, FaSolidArrowUp, FaSolidArrowDown } from "solid-icons/fa";

interface DisplayOptionsModalProps {
    show: boolean;
    preferences: DisplayPreferences;
    onClose: () => void;
    onChange: (preferences: DisplayPreferences) => void;
}

const DisplayOptionsModal: Component<DisplayOptionsModalProps> = (props) => {
    const updatePreference = <K extends keyof DisplayPreferences>(
        key: K,
        value: DisplayPreferences[K]
    ) => {
        props.onChange({
            ...props.preferences,
            [key]: value,
        });
    };

    const getSizeValue = () => {
        return ITEM_SIZES.indexOf(props.preferences.itemSize);
    };

    const handleSizeChange = (value: number) => {
        updatePreference('itemSize', ITEM_SIZES[value]);
    };

    return (
        <Show when={props.show}>
            <div class="eden-modal-overlay display-options-position" onClick={props.onClose}>
                <div class="eden-popover display-options-popover" onClick={(e) => e.stopPropagation()}>
                    <div class="eden-flex-between eden-gap-md">
                        <h3 class="eden-popover-title">{t("files.displayOptions")}</h3>
                        <button
                            class="eden-modal-close"
                            onClick={props.onClose}
                            aria-label="Close"
                        >
                            ×
                        </button>
                    </div>

                    <div class="eden-flex-col" style={{ "margin-top": "var(--eden-space-lg)" }}>
                        {/* View Style Section */}
                        <div class="eden-form-group">
                            <label class="eden-form-label">{t("files.viewStyle")}</label>
                            <div class="eden-btn-group">
                                <button
                                    class="eden-btn eden-btn-md"
                                    classList={{ 'eden-btn-primary': props.preferences.viewStyle === 'grid' }}
                                    onClick={() => updatePreference('viewStyle', 'grid')}
                                >
                                    <FaSolidGrip /> {t("files.grid")}
                                </button>
                                <button
                                    class="eden-btn eden-btn-md"
                                    classList={{ 'eden-btn-primary': props.preferences.viewStyle === 'list' }}
                                    onClick={() => updatePreference('viewStyle', 'list')}
                                >
                                    <FaSolidList /> {t("files.list")}
                                </button>
                            </div>
                        </div>

                        {/* Item Size Section */}
                        <div class="eden-form-group">
                            <label class="eden-form-label">
                                {t("files.displaySize")}: <span class="eden-badge">{t(`files.${props.preferences.itemSize}`)}</span>
                            </label>
                            <div class="eden-flex eden-gap-md" style={{ "align-items": "center" }}>
                                <span class="eden-text-xs eden-text-muted">{t("files.tiny")}</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="4"
                                    step="1"
                                    value={getSizeValue()}
                                    onInput={(e) => handleSizeChange(parseInt(e.currentTarget.value))}
                                    class="eden-slider"
                                />
                                <span class="eden-text-xs eden-text-muted">{t("files.huge")}</span>
                            </div>
                        </div>

                        {/* Sort Options Section */}
                        <div class="eden-form-group">
                            <label class="eden-form-label">{t("files.sortBy")}</label>
                            <div class="eden-flex eden-gap-sm">
                                <select
                                    class="eden-select"
                                    value={props.preferences.sortBy}
                                    onChange={(e) => updatePreference('sortBy', e.currentTarget.value as SortBy)}
                                    style={{ flex: "1" }}
                                >
                                    <option value="name">{t("common.name")}</option>
                                    <option value="size">{t("common.size")}</option>
                                    <option value="modified">{t("files.modified")}</option>
                                </select>

                                <button
                                    class="eden-btn eden-btn-sm eden-btn-square"
                                    onClick={() => updatePreference('sortOrder', props.preferences.sortOrder === 'asc' ? 'desc' : 'asc')}
                                    title={props.preferences.sortOrder === 'asc' ? t("files.ascending") : t("files.descending")}
                                >
                                    {props.preferences.sortOrder === 'asc' ? <FaSolidArrowUp /> : <FaSolidArrowDown />}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </Show>
    );
};

export default DisplayOptionsModal;
