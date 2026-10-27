// Prevent overlapping submissions from the same page, without swallowing failures.
export function singleFlight(task, onBusyChange = () => {}) {
  let busy = false;
  return async (...args) => {
    if (busy) return false;
    busy = true;
    try {
      onBusyChange(true);
      return await task(...args);
    } finally {
      busy = false;
      onBusyChange(false);
    }
  };
}
