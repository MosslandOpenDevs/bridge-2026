"use client";

import { useEffect, useState } from "react";
import { hasAdminKey, subscribeAdminKey } from "@/lib/adminKey";

/**
 * Whether this tab holds the operator key, so admin-only controls can explain
 * themselves before the request fails. Starts false during SSR and on the first
 * client render, then settles once sessionStorage is readable.
 */
export function useHasAdminKey(): boolean {
  const [present, setPresent] = useState(false);

  useEffect(() => {
    setPresent(hasAdminKey());
    return subscribeAdminKey((key) => setPresent(Boolean(key)));
  }, []);

  return present;
}
