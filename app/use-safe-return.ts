"use client";

import { useSyncExternalStore } from "react";
import { safeReturnPath } from "./safe-return";

function subscribeToLocation(onChange: () => void) {
  window.addEventListener("popstate", onChange);
  return () => window.removeEventListener("popstate", onChange);
}

function currentSearch() {
  return window.location.search;
}

function serverSearch() {
  return "";
}

export function useSafeReturnPath() {
  const search = useSyncExternalStore(
    subscribeToLocation,
    currentSearch,
    serverSearch,
  );
  return safeReturnPath(new URLSearchParams(search).get("returnTo"));
}
