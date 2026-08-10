/** A spatial edge around the caller's tiled window. */
export type TileLayoutDirection = "top" | "right" | "bottom" | "left";

/** A tiled window adjacent to one edge of the caller's window. */
export interface TileLayoutNeighbor {
  name: string | Record<string, string>;
  /** Whether the caller can temporarily cover this neighbor. */
  canExpand: boolean;
}

/** Context used to render the caller-scoped tiled-window layout controls. */
export interface TileLayoutState {
  mode: "floating" | "tiled";
  neighbors: Partial<Record<TileLayoutDirection, TileLayoutNeighbor>>;
}
