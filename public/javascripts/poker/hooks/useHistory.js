/**
 * History state, extracted from the App component.
 *
 * Fetching, deleting, and clearing history is self-contained state with its own
 * loading and error handling. Keeping it in a hook means the App reads as
 * layout rather than plumbing, and a future tracker page can reuse it as-is.
 *
 * History is now owner-scoped like a tournament: `GET /api/history` and
 * friends require a session, so this reads `useAuth()`'s status the same way
 * `TournamentManagerPage` gates its own list fetch -- no attempt while
 * logged out (it would just 401), and a refetch the moment a session becomes
 * available, whether that's the initial load resolving or a login that
 * happens while this page is already open.
 */

import { useAuth } from '../context/AuthContext.js';
import { clearHistory, deleteHistoryRecord, fetchHistory } from '../services/apiClient.js';

/**
 * @param {{limit?: number}} [options]
 * @returns {{
 *   records: object[],
 *   total: number,
 *   isLoading: boolean,
 *   error: string|null,
 *   isAuthenticated: boolean,
 *   refresh: () => Promise<void>,
 *   remove: (id: string) => Promise<void>,
 *   clear: () => Promise<void>
 * }}
 */
export function useHistory({ limit = 10 } = {}) {
  const { status: authStatus } = useAuth();
  const [records, setRecords] = React.useState([]);
  const [total, setTotal] = React.useState(0);
  const [isLoading, setIsLoading] = React.useState(true);
  const [error, setError] = React.useState(null);

  const refresh = React.useCallback(async () => {
    if (authStatus !== 'authenticated') return;
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
  }, [limit, authStatus]);

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
    // Wait for the initial auth check rather than guessing: fetching and
    // then discarding a moment later (or the reverse) would just be a flash
    // of the wrong content.
    if (authStatus === 'loading') return;

    if (authStatus !== 'authenticated') {
      // Nothing remembered client-side for a logged-out visitor -- unlike
      // the Tournament Manager's anonymous fallback, an anonymous
      // calculation has no path back to its owner, so there is nothing here
      // to show but an empty panel.
      setRecords([]);
      setTotal(0);
      setError(null);
      setIsLoading(false);
      return;
    }

    refresh();
  }, [authStatus, refresh]);

  return { records, total, isLoading, error, isAuthenticated: authStatus === 'authenticated', refresh, remove, clear };
}
