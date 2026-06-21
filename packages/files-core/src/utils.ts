import type { FileItem } from "./types";

export const joinPath = (...parts: string[]) => {
  return parts.join("/").replace(/\/+/g, "/").replace(/\/$/, "") || "/";
};

export const getParentPath = (path: string) => {
  if (path === "/") return "/";
  const parts = path.split("/").filter((p) => p);
  parts.pop();
  return `/${parts.join("/")}`;
};

export const isValidName = (name: string) => {
  return /^[a-zA-Z0-9._-]+$/.test(name);
};

export const formatFileSize = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Math.round((bytes / k ** i) * 100) / 100} ${sizes[i]}`;
};

export const getFileIcon = (item: FileItem) => {
  if (item.isDirectory) return "📁";

  const ext = item.name.split(".").pop()?.toLowerCase() || "";
  const iconMap: Record<string, string> = {
    txt: "📄",
    md: "📝",
    js: "📜",
    json: "📋",
    html: "🌐",
    css: "🎨",
    png: "🖼️",
    jpg: "🖼️",
    pdf: "📕",
    zip: "📦",
  };

  return iconMap[ext] || "📄";
};
