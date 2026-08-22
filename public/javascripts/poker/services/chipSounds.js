/**
 * The sound of chips being pushed into the middle.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file.
 * That is the same "minimise dependencies" call the rest of the app makes: a
 * convincing chip rattle is a few bursts of filtered noise, and writing it is
 * cheaper than adding a binary asset to the repo, choosing a codec that every
 * browser accepts, and paying a network request for it on a page that may
 * never play a sound at all. Nothing is loaded until the first sweep.
 *
 * A chip click is a very short, bright, fast-decaying noise -- closer to a
 * hi-hat than to a tone. So each click is white noise through a narrow
 * bandpass with a near-instant attack and a ~60ms decay, and a sweep is a
 * handful of those staggered a few milliseconds apart. Several chips landing
 * at slightly different times is the whole effect; a single click reads as a
 * UI beep, and simultaneous clicks read as one.
 *
 * The `AudioContext` is built lazily on the first sweep rather than at import.
 * Browsers refuse to start audio outside a user gesture, and every sweep here
 * comes from a click or a key press -- but a context constructed at page load
 * would be born `suspended` and stay that way, so the first sound would be
 * silently dropped.
 *
 * Note the `Math.random()` calls: the "randomness comes from an injected Rng"
 * rule covers `src/shared/`, where a seed is what makes a result reproducible.
 * Nothing here is recorded, asserted on, or replayed -- the jitter *is* the
 * feature, and two identical sweeps in a row are what would sound wrong.
 */

const STORAGE_KEY = 'pokerLab.chipSoundMuted';

/** Built on the first sweep, then reused for the life of the page. */
let context = null;
/** One noise buffer serves every click; regenerating it per chip is waste. */
let noiseBuffer = null;

/**
 * @returns {AudioContext|null} null where Web Audio is unavailable or blocked,
 *   which is a silent replay rather than an error
 */
function audioContext() {
  if (context) return context;

  const Constructor = window.AudioContext || window.webkitAudioContext;
  if (!Constructor) return null;

  try {
    context = new Constructor();
  } catch {
    return null;
  }
  return context;
}

/**
 * White noise, long enough for one click.
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function noise(ctx) {
  if (noiseBuffer) return noiseBuffer;

  const frames = Math.floor(ctx.sampleRate * 0.08);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1;

  noiseBuffer = buffer;
  return buffer;
}

/**
 * One chip landing on the pile.
 *
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {number} at when to play, on the context's clock
 * @param {number} peak loudest point of the envelope, 0 to 1
 */
function scheduleClick(ctx, buffer, at, peak) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Varying the rate shifts the noise's character per chip, so a stack does
  // not sound like the same sample played five times.
  source.playbackRate.value = 0.85 + Math.random() * 0.4;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  // Clay chips ring in the low kilohertz. Below this it turns into a thud,
  // above it into a tick.
  filter.frequency.value = 1900 + Math.random() * 1700;
  filter.Q.value = 3.2;

  const gain = ctx.createGain();
  // An exponential tail, not a linear one -- a linear fade on a click reads as
  // a tiny fade-out rather than as something hard striking something hard.
  // It cannot ramp to zero, hence the epsilon.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(peak, at + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
  // Stopping releases the node; without it they accumulate for the page's life.
  source.stop(at + 0.09);
}

/**
 * Play chips being swept into the middle.
 *
 * Safe to call unconditionally: it returns quietly when the user has muted,
 * when the browser has no Web Audio, or when the context refuses to start.
 *
 * @param {number} [chipCount] roughly how many stacks are moving, which sets
 *   how busy the rattle is; clamped to a sensible range either way
 */
export function playChipSweep(chipCount = 3) {
  if (isChipSoundMuted()) return;

  const ctx = audioContext();
  if (!ctx) return;
  // A context can be suspended by autoplay policy even when built inside a
  // gesture, and it suspends again if the tab is backgrounded.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const buffer = noise(ctx);
  const clicks = Math.max(2, Math.min(6, Math.round(chipCount)));
  // A hair in the future: scheduling at exactly `currentTime` can land in a
  // block that has already been rendered, which drops the first click.
  let at = ctx.currentTime + 0.01;

  for (let index = 0; index < clicks; index += 1) {
    // Later chips are quieter, so the rattle settles instead of stopping dead.
    scheduleClick(ctx, buffer, at, 0.16 - index * 0.012);
    at += 0.028 + Math.random() * 0.022;
  }
}

/**
 * @returns {boolean} whether the user has silenced the replay
 */
export function isChipSoundMuted() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    // A disabled store is not a reason to refuse to play.
    return false;
  }
}

/**
 * Remember the preference, so muting survives a reload and a shared link
 * opened later doesn't start making noise again.
 * @param {boolean} muted
 */
export function setChipSoundMuted(muted) {
  try {
    window.localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
  } catch {
    // Nothing to do: the toggle still works for this page view.
  }
}
