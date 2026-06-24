const DEFAULT_APP_ICON_SVG = `<svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="bg" x1="32" y1="4" x2="32" y2="60" gradientUnits="userSpaceOnUse"><stop stop-color="#4a4a4a"/><stop offset="1" stop-color="#3a3a3a"/></linearGradient></defs><rect x="4" y="4" width="56" height="56" rx="14" fill="url(#bg)"/><g transform="translate(16, 16)" fill="#e0e0e0"><rect x="5" y="6" width="22" height="3" rx="1.5"/><rect x="5" y="13" width="22" height="3" rx="1.5"/><rect x="5" y="20" width="15" height="3" rx="1.5"/><rect x="5" y="27" width="22" height="3" rx="1.5"/></g></svg>`;

export const DEFAULT_APP_ICON_DATA_URL = `data:image/svg+xml;base64,${Buffer.from(
  DEFAULT_APP_ICON_SVG,
).toString("base64")}`;
