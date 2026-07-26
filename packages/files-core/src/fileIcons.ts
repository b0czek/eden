export const fileIcons = {
  archive: new URL("./generated/noto/package.svg", import.meta.url).href,
  clipboard: new URL("./generated/noto/clipboard.svg", import.meta.url).href,
  document: new URL("./generated/noto/page-facing-up.svg", import.meta.url)
    .href,
  folder: new URL("./generated/noto/file-folder.svg", import.meta.url).href,
  globe: new URL("./generated/noto/globe-with-meridians.svg", import.meta.url)
    .href,
  image: new URL("./generated/noto/framed-picture.svg", import.meta.url).href,
  markdown: new URL("./generated/noto/memo.svg", import.meta.url).href,
  openFolder: new URL("./generated/noto/open-file-folder.svg", import.meta.url)
    .href,
  palette: new URL("./generated/noto/artist-palette.svg", import.meta.url).href,
  pdf: new URL("./generated/noto/closed-book.svg", import.meta.url).href,
  script: new URL("./generated/noto/scroll.svg", import.meta.url).href,
} as const;

export type FileGraphicUrl = (typeof fileIcons)[keyof typeof fileIcons];
