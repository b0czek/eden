export const buildBreadcrumbs = (path: string) => {
  const parts = path.split("/").filter((p) => p);

  const crumbs = [{ name: "/", path: "/" }];
  let accumulatedPath = "";

  parts.forEach((part) => {
    accumulatedPath += `/${part}`;
    crumbs.push({ name: part, path: accumulatedPath });
  });

  return crumbs;
};
