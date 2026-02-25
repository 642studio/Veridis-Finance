export const FINANCE_DATA_REFRESH_EVENT = "veridis:finance-data-refresh";

export function emitFinanceDataRefresh(source = "unknown") {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(FINANCE_DATA_REFRESH_EVENT, {
      detail: { source },
    })
  );
}

export function onFinanceDataRefresh(callback: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = () => callback();
  window.addEventListener(FINANCE_DATA_REFRESH_EVENT, handler as EventListener);

  return () => {
    window.removeEventListener(FINANCE_DATA_REFRESH_EVENT, handler as EventListener);
  };
}
