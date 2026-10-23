export function createSerializedRefreshQueue() {
  let version = 0;
  let inFlight = false;
  let queued = false;

  return {
    begin() {
      if (inFlight) {
        queued = true;
        return null;
      }
      inFlight = true;
      return ++version;
    },
    isCurrent(requestVersion) {
      return requestVersion === version;
    },
    invalidate() {
      version += 1;
    },
    markQueued() {
      if (inFlight) queued = true;
    },
    finish(requestVersion) {
      const current = requestVersion === version;
      const shouldRefresh = queued;
      inFlight = false;
      queued = false;
      return { current, shouldRefresh };
    },
    cancelQueued() {
      queued = false;
    }
  };
}
