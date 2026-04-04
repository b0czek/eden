#!/usr/bin/env python3
"""Generate a source-backed EdenCSS inventory for the eden-frontend skill."""

from __future__ import annotations

import re
from collections import defaultdict
from pathlib import Path


TOKEN_DEF_RE = re.compile(r"^\s*(--eden-[a-z0-9-]+):\s*(.+);", re.MULTILINE)
SECTION_RE = re.compile(r"/\*\s*=+\s*(.*?)\s*=+\s*\*/")
CLASS_RE = re.compile(r"\.(eden-[A-Za-z0-9_-]+)\b")
VAR_USE_RE = re.compile(r"var\((--eden-[a-z0-9-]+)\)")
CSS_IMPORT_RE = re.compile(r'["\'](\./[^"\']+\.css)["\']')
APP_CLASS_RE = re.compile(r"(?<!-)\beden-[A-Za-z0-9_-]+\b")


def chunk(items: list[str], size: int) -> list[list[str]]:
    return [items[index : index + size] for index in range(0, len(items), size)]


def format_code_list(items: list[str], size: int = 6) -> str:
    if not items:
        return "- None"
    return "\n".join(
        "- " + ", ".join(f"`{item}`" for item in group) for group in chunk(items, size)
    )


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def parse_token_groups(tokens_css: Path) -> dict[str, list[str]]:
    groups: dict[str, list[str]] = defaultdict(list)
    for name, _value in TOKEN_DEF_RE.findall(read_text(tokens_css)):
        group = name.removeprefix("--eden-").split("-")[0]
        groups[group].append(name)
    return {group: sorted(values) for group, values in sorted(groups.items())}


def parse_css_sections(path: Path) -> tuple[dict[str, list[str]], set[str]]:
    sections: dict[str, list[str]] = defaultdict(list)
    var_uses: set[str] = set()
    current_section = "Ungrouped"
    seen_by_section: dict[str, set[str]] = defaultdict(set)

    for line in read_text(path).splitlines():
        match = SECTION_RE.search(line)
        if match:
            current_section = match.group(1).strip()
            continue

        for var_name in VAR_USE_RE.findall(line):
            var_uses.add(var_name)

        for class_name in CLASS_RE.findall(line):
            if class_name not in seen_by_section[current_section]:
                sections[current_section].append(class_name)
                seen_by_section[current_section].add(class_name)

    ordered = {
        section: values for section, values in sections.items() if values
    }
    return ordered, var_uses


def parse_css_imports(path: Path) -> list[str]:
    return CSS_IMPORT_RE.findall(read_text(path))


def collect_defined_classes(paths: list[Path]) -> set[str]:
    classes: set[str] = set()
    for path in paths:
        classes.update(CLASS_RE.findall(read_text(path)))
    return classes


def collect_app_classes(apps_dir: Path) -> set[str]:
    class_names: set[str] = set()
    for path in apps_dir.rglob("*"):
        if not path.is_file():
            continue
        if "example" in path.parts:
            continue
        if path.suffix not in {".tsx", ".ts", ".jsx", ".js", ".html"}:
            continue
        class_names.update(APP_CLASS_RE.findall(read_text(path)))
    return class_names


def main() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    skill_root = Path(__file__).resolve().parents[1]
    edencss_dir = repo_root / "packages/sdk/edencss"
    apps_dir = repo_root / "packages/sdk/apps/com/eden"

    tokens_css = edencss_dir / "tokens.css"
    utilities_css = edencss_dir / "utilities.css"
    eden_css = edencss_dir / "eden.css"
    index_ts = edencss_dir / "index.ts"
    component_files = sorted((edencss_dir / "components").glob("*.css"))

    token_groups = parse_token_groups(tokens_css)
    utility_sections, utility_var_uses = parse_css_sections(utilities_css)

    component_sections: dict[str, dict[str, list[str]]] = {}
    component_var_uses: set[str] = set()
    for component_file in component_files:
        sections, var_uses = parse_css_sections(component_file)
        component_sections[component_file.name] = sections
        component_var_uses.update(var_uses)

    token_names = {name for group in token_groups.values() for name in group}
    eden_css_imports = parse_css_imports(eden_css)
    index_ts_imports = parse_css_imports(index_ts)
    missing_from_index = sorted(set(eden_css_imports) - set(index_ts_imports))

    defined_classes = collect_defined_classes([utilities_css, *component_files])
    app_classes = collect_app_classes(apps_dir)
    app_only_classes = sorted(app_classes - defined_classes)

    lines: list[str] = [
        "# EdenCSS Surface",
        "",
        "Generated from `packages/sdk/edencss/` and non-example apps under `packages/sdk/apps/com/eden/`.",
        "",
        "## Bundle And Injection",
        "",
        "- `packages/sdk/src/view-manager/ViewCreator.ts` defaults `window.injections.css` to `full` when omitted.",
        "- `full` injection loads the built `eden.css` bundle; `tokens` loads the built `eden-tokens.css` bundle.",
        "- `packages/sdk/edencss/eden.css` is the authoritative full bundle source in this repo.",
        "",
        "### CSS Files Imported By `eden.css`",
        "",
        *[
            f"- `{css_import}`"
            for css_import in eden_css_imports
        ],
        "",
        "### CSS Files Imported By `index.ts`",
        "",
        *[
            f"- `{css_import}`"
            for css_import in index_ts_imports
        ],
        "",
        "### Present In `eden.css` But Not Imported By `index.ts`",
        "",
    ]
    lines.extend(f"- `{item}`" for item in missing_from_index)

    lines.extend(
        [
            "",
            "## Token Groups",
            "",
        ]
    )
    for group, names in token_groups.items():
        lines.extend(
            [
                f"### `{group}` ({len(names)})",
                "",
                format_code_list(names),
                "",
            ]
        )

    lines.extend(
        [
            "## Utility Classes",
            "",
        ]
    )
    for section, classes in utility_sections.items():
        lines.extend(
            [
                f"### {section}",
                "",
                format_code_list(classes),
                "",
            ]
        )

    lines.extend(
        [
            "## Component Classes",
            "",
        ]
    )
    for filename, sections in component_sections.items():
        total_classes = sum(len(values) for values in sections.values())
        lines.extend(
            [
                f"### `{filename}` ({total_classes})",
                "",
            ]
        )
        for section, classes in sections.items():
            lines.extend(
                [
                    f"#### {section}",
                    "",
                    format_code_list(classes),
                    "",
                ]
            )

    lines.extend(
        [
            "## Source Caveats",
            "",
            "### `eden-*` Class Names Used In Non-Example Apps But Not Defined By Shared EdenCSS",
            "",
            format_code_list(app_only_classes),
            "",
            "Treat these as app-local helpers, stale assumptions, or classes that require local CSS instead of shared EdenCSS.",
            "",
        ]
    )

    output_path = skill_root / "references/edencss-surface.md"
    output_path.write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    main()
