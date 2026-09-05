/**
 * Who's logged in, shared across the whole app.
 *
 * Everything that needs to know -- `Nav` showing an account menu, a
 * protected page deciding whether to redirect -- needs the *same* answer at
 * the *same* moment a login or logout happens elsewhere in the tree. That's
 * a genuinely shared, reactive requirement, unlike `tableTheme.js`'s
 * preference, which nothing needs to react to changing out from under it.
 * One context, mounted once in `AppShell`, is the plain fit.
 */

import { fetchCurrentUser, login as apiLogin, logout as apiLogout, onUnauthorized, signup as apiSignup } from '../services/apiClient.js';
import { navigate, useSearchParam } from '../router.js';

const AuthContext = React.createContext(null);

const e = React.createElement;

/**
 * @param {{children: *}} props
 */
export function AuthProvider({ children }) {
  // 'loading' until the initial /api/auth/me settles, then 'authenticated' or
  // 'anonymous'. A page deciding whether to redirect has to be able to tell
  // "we don't know yet" apart from "we checked, and there's nobody" -- the
  // first should wait, the second should redirect.
  const [status, setStatus] = React.useState('loading');
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    let cancelled = false;

    fetchCurrentUser()
      .then(({ user: loaded }) => { if (!cancelled) { setUser(loaded); setStatus('authenticated'); } })
      .catch(() => { if (!cancelled) { setUser(null); setStatus('anonymous'); } });

    return () => { cancelled = true; };
  }, []);

  React.useEffect(() => {
    // A session can end while its own page is open -- the cookie expires, or
    // it's revoked from another tab -- and the next call that page happens to
    // make will 401. `apiClient` is the one place that sees every request, so
    // it's the one place that can notice this regardless of which page
    // triggered it, and tell every subscriber at once rather than leaving
    // each page to notice on its own next failed call.
    return onUnauthorized(() => {
      setUser(null);
      setStatus('anonymous');
    });
  }, []);

  const login = React.useCallback(async (credentials) => {
    const { user: loggedIn } = await apiLogin(credentials);
    setUser(loggedIn);
    setStatus('authenticated');
    return loggedIn;
  }, []);

  const signup = React.useCallback(async (payload) => {
    const { user: created } = await apiSignup(payload);
    setUser(created);
    setStatus('authenticated');
    return created;
  }, []);

  const logout = React.useCallback(async () => {
    await apiLogout();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = React.useMemo(
    () => ({ status, user, login, signup, logout }),
    [status, user, login, signup, logout]
  );

  return e(AuthContext.Provider, { value }, children);
}

/**
 * @returns {{status: 'loading'|'authenticated'|'anonymous', user: object|null,
 *   login: (credentials: {email: string, password: string}) => Promise<object>,
 *   signup: (payload: {email: string, password: string, displayName: string}) => Promise<object>,
 *   logout: () => Promise<void>}}
 */
export function useAuth() {
  const context = React.useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside an AuthProvider.');
  return context;
}

/**
 * Gate a page behind a session. Renders nothing while the initial auth check
 * is in flight -- not a spinner, since this resolves in one request on mount
 * and a flash of "loading" would be more distracting than a brief blank --
 * and redirects to `/login?next=<path>` the moment `status` settles on
 * `anonymous`, carrying the original path so a successful login returns here
 * instead of dropping the user at the homepage.
 *
 * @param {{path: string, children: *}} props `path` is the route this guard
 *   is protecting, from `useRoute()` -- passed in rather than read again here
 *   so there's one reader of the current path per render, not two
 */
export function RequireAuth({ path, children }) {
  const { status } = useAuth();

  React.useEffect(() => {
    if (status === 'anonymous') {
      navigate(`/login?next=${encodeURIComponent(path)}`);
    }
  }, [status, path]);

  if (status !== 'authenticated') return null;
  return children;
}

/**
 * Where to send someone after they log in or sign up -- the page `RequireAuth`
 * sent them away from, or `/` if they arrived at `/login` directly.
 * @returns {string}
 */
export function useAuthRedirectTarget() {
  const next = useSearchParam('next');
  return next || '/';
}
