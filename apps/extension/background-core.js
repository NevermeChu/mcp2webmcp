/**
 * Pure helpers for background.js state transitions. No chrome.* calls here so
 * the snapshot/generation logic can be unit-tested in Node.
 */

export function sourceIdFor(tabId) {
  return `tab:${tabId}`;
}

export function originFromTabUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}

/**
 * Merge a page snapshot into the stored tab state.
 * Returns { state, kind, reason }: kind is "new" (first snapshot, generation 1),
 * "bump" (page reload or navigation, generation+1) or "update" (same page).
 */
export function applyPageSnapshot(existing, snapshot) {
  const { origin, url, title, pageInstanceId, tools, runtimePresent, runtimeError } = snapshot;
  if (!existing) {
    return {
      state: {
        origin,
        url,
        title,
        pageInstanceId,
        runtimePresent,
        runtimeError,
        tools,
        generation: 1,
      },
      kind: "new",
      reason: "connect",
    };
  }
  const reload = Boolean(
    pageInstanceId && existing.pageInstanceId && pageInstanceId !== existing.pageInstanceId,
  );
  const navigated = existing.origin !== origin || existing.url !== url;
  const state = {
    ...existing,
    origin,
    url,
    title,
    runtimePresent,
    runtimeError,
    tools,
  };
  if (reload || navigated) {
    state.generation = existing.generation + 1;
    state.pageInstanceId = pageInstanceId;
    return { state, kind: "bump", reason: reload ? "reload" : "navigate" };
  }
  if (!state.pageInstanceId && pageInstanceId) {
    state.pageInstanceId = pageInstanceId;
  }
  return { state, kind: "update", reason: "update" };
}
