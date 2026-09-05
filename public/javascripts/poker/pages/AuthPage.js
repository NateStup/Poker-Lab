/**
 * `/login` and `/signup` -- the same page, in two modes.
 *
 * Two routes rather than one page with an internal toggle: a page's own
 * back-button behavior and its shareability both come for free from being
 * a real path, and the router already treats every path as a distinct
 * `Link` target. Switching modes is a normal navigation to the other route,
 * not local state pretending to be one.
 */

import { useAuth, useAuthRedirectTarget } from '../context/AuthContext.js';
import { Link, navigate } from '../router.js';

const e = React.createElement;

/**
 * @param {object} props
 * @param {'login'|'signup'} props.mode
 */
export function AuthPage({ mode }) {
  const { login, signup } = useAuth();
  const redirectTo = useAuthRedirectTarget();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [displayName, setDisplayName] = React.useState('');
  const [error, setError] = React.useState(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const isSignup = mode === 'signup';

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (isSignup) {
        await signup({ email, password, displayName });
      } else {
        await login({ email, password });
      }
      navigate(redirectTo);
    } catch (err) {
      // The server's own message is already written to avoid confirming
      // which emails have accounts (see AuthService.login) -- shown as-is
      // rather than replaced with something generic here.
      setError(err.message);
      setIsSubmitting(false);
    }
  }

  return e(
    'div',
    { className: 'hero-card' },
    e('h1', null, isSignup ? 'Create an account' : 'Log in'),

    e(
      'form',
      { className: 'card-form', onSubmit: handleSubmit },

      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'auth-email' }, 'Email'),
        e('input', {
          id: 'auth-email',
          type: 'email',
          required: true,
          value: email,
          onChange: event => setEmail(event.target.value),
          autoComplete: 'email'
        })
      ),

      isSignup
        ? e(
            'div',
            { className: 'field-group' },
            e('label', { htmlFor: 'auth-display-name' }, 'Display name'),
            e('input', {
              id: 'auth-display-name',
              type: 'text',
              required: true,
              maxLength: 60,
              value: displayName,
              onChange: event => setDisplayName(event.target.value),
              autoComplete: 'nickname'
            })
          )
        : null,

      e(
        'div',
        { className: 'field-group' },
        e('label', { htmlFor: 'auth-password' }, 'Password'),
        e('input', {
          id: 'auth-password',
          type: 'password',
          required: true,
          minLength: 8,
          value: password,
          onChange: event => setPassword(event.target.value),
          autoComplete: isSignup ? 'new-password' : 'current-password'
        }),
        isSignup ? e('span', { className: 'footnote' }, 'At least 8 characters.') : null
      ),

      // `.error-card` is what every other form in this app puts a failure in
      // (see HandBuilderForm.js); `.range-notation-error` is the Range
      // Explorer's own inline-notation styling and does not belong here.
      error ? e('div', { className: 'error-card' }, e('p', null, error)) : null,

      e(
        'div',
        { className: 'form-actions' },
        e('button', { type: 'submit', disabled: isSubmitting }, isSignup ? 'Create account' : 'Log in')
      )
    ),

    e(
      'p',
      { className: 'small' },
      isSignup
        ? e(React.Fragment, null, 'Already have an account? ', e(Link, { to: '/login' }, 'Log in'))
        : e(React.Fragment, null, "Don't have an account? ", e(Link, { to: '/signup' }, 'Sign up'))
    )
  );
}
