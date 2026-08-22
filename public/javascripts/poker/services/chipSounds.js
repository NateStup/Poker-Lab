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
 * The sound is a dealer *raking* chips in, and a rake is two things at once.
 * Underneath is the scrape of chips dragged across felt: wide-band noise held
 * for a few hundred milliseconds with its filter sweeping downward, which is
 * what makes it read as something moving toward you rather than a burst of
 * static. Over it is the clatter of chips knocking together -- a dozen very
 * short, bright clicks scattered irregularly through that window.
 *
 * Both layers are needed. The scrape alone is a "shh" with no chips in it; the
 * clicks alone are a handful of separate taps rather than a mass of chips
 * being moved. And the clicks are scattered at random rather than evenly
 * spaced, because an even stagger is heard as a rhythm, which is the one thing
 * a rake is not.
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

  // Long enough to cover a whole rake without looping audibly -- a short
  // buffer looped through a filter develops a periodic thrum.
  const frames = Math.floor(ctx.sampleRate * 0.7);
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
 * The scrape underneath: chips dragged across felt.
 *
 * The filter sweeping downward is what sells the direction of travel. A fixed
 * band is static hiss; falling through the band as the gain decays is heard as
 * a mass of something arriving and settling.
 *
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {number} at when to start, on the context's clock
 * @param {number} duration seconds
 */
function scheduleRake(ctx, buffer, at, duration) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  // Deliberately wide. A high Q here whistles; a rake is broadband.
  filter.Q.value = 0.8;
  filter.frequency.setValueAtTime(3400, at);
  filter.frequency.exponentialRampToValueAtTime(850, at + duration);

  const gain = ctx.createGain();
  // A softer attack than a click: the rake takes hold of the chips rather
  // than striking them.
  gain.gain.setValueAtTime(0, at);
  gain.gain.linearRampToValueAtTime(0.085, at + 0.06);
  gain.gain.setValueAtTime(0.085, at + duration * 0.5);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);

  source.connect(filter).connect(gain).connect(ctx.destination);
  source.start(at);
  source.stop(at + duration + 0.02);
}

/** How long a rake takes, in seconds. */
const RAKE_SECONDS = 0.36;

/**
 * Play chips being raked into the middle.
 *
 * Safe to call unconditionally: it returns quietly when the user has muted,
 * when the browser has no Web Audio, or when the context refuses to start.
 *
 * @param {number} [chipCount] roughly how many stacks are moving, which sets
 *   how much chip clatter rides over the scrape; clamped either way
 */
export function playChipSweep(chipCount = 3) {
  if (isChipSoundMuted()) return;

  const ctx = audioContext();
  if (!ctx) return;
  // A context can be suspended by autoplay policy even when built inside a
  // gesture, and it suspends again if the tab is backgrounded.
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});

  const buffer = noise(ctx);
  // A hair in the future: scheduling at exactly `currentTime` can land in a
  // block that has already been rendered, which drops the attack.
  const start = ctx.currentTime + 0.01;

  scheduleRake(ctx, buffer, start, RAKE_SECONDS);

  // Chips knocking together as they are dragged. Scattered at random through
  // the rake -- an even spacing would be heard as a beat.
  const clatter = Math.max(7, Math.min(18, Math.round(chipCount * 4)));
  for (let index = 0; index < clatter; index += 1) {
    const offset = 0.02 + Math.random() * (RAKE_SECONDS - 0.08);
    // Quieter than a lone click was: here they sit on top of the scrape
    // rather than being the whole sound, and they thin out toward the end as
    // the chips come to rest.
    const fade = 1 - (offset / RAKE_SECONDS) * 0.55;
    scheduleClick(ctx, buffer, start + offset, (0.05 + Math.random() * 0.04) * fade);
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
