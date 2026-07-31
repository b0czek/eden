/** Match an exact grant or one of its wildcard parents. */
export const matchesGrant = (grants: string[], required: string): boolean => {
  if (grants.includes(required)) return true;
  return grants.some((granted) => {
    if (granted === "*") return true;
    if (!granted.endsWith("/*")) return false;
    return required.startsWith(`${granted.slice(0, -2)}/`);
  });
};
