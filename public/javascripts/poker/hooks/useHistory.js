/**
 * History state, extracted from the App component.
 *
 * Fetching, deleting, and clearing history is self-contained state with its own
 * loading and error handling. Keeping it in a hook means the App reads as
 * layout rather than plumbing, and a future tracker page can reuse it as-is.
 */

import { clearHistory, deleteHistoryRecord, fetchHistory } from '../services/apiClient.js';

/**
 * @param {{limit?: number}} [options]
 * @returns {{
 *   records: object[],
 *   total: number,
 *   isLoading: boolean,
 *   error: string|null,
 *   refresh: () => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 *   clear: () => Promise<void>
 * }}
 */
export function useHistory({ limit = 10 } = {}) {
  const [records, setRecords] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const page = await fetchHistory({ limit });
      setRecords(page.items);
      setTotal(page.total);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load history.');
    } finally {
      setIsLoading(false);
    }
  }, [limit]);

  const remove = React.useCallback(async id => {
    // Optimistic: the row disappears immediately, and a failed delete is
    // corrected by the refresh in the catch branch.
    setRecords(current => current.filter(record => record.id !== id));
    setTotal(current => Math.max(0, current - 1));
    try {
      await deleteHistoryRecord(id);
    } catch (err) {
      setError(err.message || 'Could not delete that record.');
      await refresh();
    }
  }, [refresh]);

  const clear = React.useCallback(async () => {
    try {
      await clearHistory();
      setRecords([]);
      setTotal(0);
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not clear history.');
    }
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return { records, total, isLoading, error, refresh, remove, clear };
}
