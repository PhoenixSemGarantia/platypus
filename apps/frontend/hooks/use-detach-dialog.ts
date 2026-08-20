import { useState } from "react";

/**
 * The Shared-resource detach dialog's state, duplicated across agents-list,
 * mcp-list, skills-list, and providers-list (#598): which org-scoped item is
 * selected, and the error from a failed detach — always opened and cleared
 * together, so they're one piece of state rather than two kept in sync by
 * hand at every call site.
 */
export function useDetachDialog<T>() {
  const [selected, setSelected] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = (item: T) => {
    setError(null);
    setSelected(item);
  };

  const close = () => {
    setSelected(null);
    setError(null);
  };

  return { selected, error, setError, open, close };
}
