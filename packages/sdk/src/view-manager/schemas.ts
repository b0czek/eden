import * as v from "valibot";
export const viewBoundsSchema = v.object({
  x: v.number(),
  y: v.number(),
  width: v.pipe(v.number(), v.minValue(0)),
  height: v.pipe(v.number(), v.minValue(0)),
});

export const interfaceScaleSchema = v.pipe(
  v.number(),
  v.finite(),
  v.minValue(0.5),
  v.maxValue(2),
);
