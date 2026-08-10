export const findComposedAncestor = (
  element: Element,
  predicate: (candidate: Element) => boolean,
): Element | null => {
  let candidate: Element | null = element;

  while (candidate) {
    if (predicate(candidate)) {
      return candidate;
    }

    if (candidate.parentElement) {
      candidate = candidate.parentElement;
      continue;
    }

    const root = candidate.getRootNode();
    candidate = root instanceof ShadowRoot ? root.host : null;
  }

  return null;
};

export const getDeepActiveElement = (): Element | null => {
  let activeElement: Element | null = document.activeElement;

  while (activeElement?.shadowRoot?.activeElement) {
    activeElement = activeElement.shadowRoot.activeElement;
  }

  return activeElement;
};
