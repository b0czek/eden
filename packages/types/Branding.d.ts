/**
 * Renderer-safe branding information.
 *
 * Filesystem paths are intentionally not exposed to applications.
 */
export interface EdenBrandingInfo {
  name: string;
  logoDataUrl?: string;
}
