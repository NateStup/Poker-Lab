/**
 * The sound of chips being raked into the middle.
 *
 * Synthesised with the Web Audio API rather than shipped as an audio file.
 * That is the same "minimise dependencies" call the rest of the app makes, and
 * nothing is loaded at all until the first sweep.
 *
 * **A chip is a pitched clack, not a hiss.** The first version of this built
 * everything out of filtered noise, and filtered noise is what it sounded
 * like: a long "shh" with some ticks in it. What a clay disc actually makes is
 * a *struck* sound -- a very short strike transient followed by the disc
 * ringing at a handful of frequencies that die away in well under a tenth of a
 * second. So a clack here is oscillators, not noise:
 *
 * - three partials at inharmonic ratios (a disc is not a string, so its
 *   overtones are not whole multiples), each decaying exponentially,
 * - with a 6ms noise tick on top for the strike itself.
 *
 * Pitch is drawn per clack from the range chips actually sound in, which is
 * what makes a pile clatter instead of repeating one note.
 *
 * A rake is then simply a lot of those, scattered at random through half a
 * second. There is deliberately no sustained noise bed underneath: density of
 * clacks is what reads as "a mass of chips", and a bed loud enough to hear is
 * a bed loud enough to be the hiss this used to be.
 *
 * Note the `Math.random()` calls: the "randomness comes from an injected Rng"
 * rule covers `src/shared/`, where a seed is what makes a result reproducible.
 * Nothing here is recorded, asserted on, or replayed -- the jitter *is* the
 * feature, and two identical rakes in a row are what would sound wrong.
 */

const STORAGE_KEY = 'pokerLab.chipSoundMuted';

/** Built on the first sweep, then reused for the life of the page. */
let context = null;
/** Master bus, so overall level lives in one place. */
let master = null;
/** One noise buffer serves every strike tick. */
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
 * Everything plays into here rather than straight at the speakers.
 *
 * The compressor is what makes the density safe: two dozen clacks can land
 * close enough together to sum past full scale, and clipping on a sound this
 * bright is an unpleasant crackle rather than a loud chip.
 *
 * @param {AudioContext} ctx
 * @returns {GainNode}
 */
function bus(ctx) {
  if (master) return master;

  master = ctx.createGain();
  master.gain.value = 0.55;

  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18;
  compressor.ratio.value = 6;
  compressor.attack.value = 0.002;
  compressor.release.value = 0.12;

  master.connect(compressor).connect(ctx.destination);
  return master;
}

/**
 * White noise, for the strike transients.
 * @param {AudioContext} ctx
 * @returns {AudioBuffer}
 */
function noise(ctx) {
  if (noiseBuffer) return noiseBuffer;

  const frames = Math.floor(ctx.sampleRate * 0.1);
  const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) channel[i] = Math.random() * 2 - 1;

  noiseBuffer = buffer;
  return buffer;
}

/**
 * The ratios a small disc rings at. Not whole multiples -- that is the
 * difference between a chip and a plucked string.
 */
const PARTIALS = Object.freeze([1, 2.37, 4.16]);

/**
 * One chip knocking against another.
 *
 * @param {AudioContext} ctx
 * @param {AudioBuffer} buffer
 * @param {number} at when to play, on the context's clock
 * @param {number} peak loudest point, 0 to 1
 */
function scheduleClack(ctx, buffer, at, peak) {
  const out = bus(ctx);
  const base = 470 + Math.random() * 520;
  const decay = 0.04 + Math.random() * 0.035;

  PARTIALS.forEach((ratio, index) => {
    const oscillator = ctx.createOscillator();
    // Triangle rather than sine: a touch of edge, well short of a square's buzz.
    oscillator.type = 'triangle';
    // Detuned a little per partial, so repeated clacks never phase-lock into
    // sounding like one pitched instrument.
    oscillator.frequency.value = base * ratio * (0.98 + Math.random() * 0.04);

    const gain = ctx.createGain();
    // Upper partials are quieter and die first, which is what makes the clack
    // read as a small hard object rather than a bell.
    const partialPeak = peak / (index + 1.6);
    const partialDecay = decay / (index + 1);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(partialPeak, at + 0.001);
    // Exponential, because a linear fade on something struck reads as a
    // fade-out rather than as a strike. It cannot reach zero, hence the epsilon.
    gain.gain.exponentialRampToValueAtTime(0.0001, at + partialDecay);

    oscillator.connect(gain).connect(out);
    oscillator.start(at);
    // Stopping releases the node; without it they accumulate for the page's life.
    oscillator.stop(at + partialDecay + 0.02);
  });

  // The strike itself: a tick, over almost before it starts.
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = 0.9 + Math.random() * 0.3;

  const filter = ctx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 2600;

  const tick = ctx.createGain();
  tick.gain.setValueAtTime(0, at);
  tick.gain.linearRampToValueAtTime(peak * 0.5, at + 0.001);
  tick.gain.exponentialRampToValueAtTime(0.0001, at + 0.007);

  source.connect(filter).connect(tick).connect(out);
  source.start(at);
  source.stop(at + 0.03);
}

/** How long a rake's clatter is spread over, in seconds. */
const RAKE_SECONDS = 0.52;

/**
 * Play chips being raked into the middle.
 *
 * Safe to call unconditionally: it returns quietly when the user has muted,
 * when the browser has no Web Audio, or when the context refuses to start.
 *
 * @param {number} [chipCount] roughly how many stacks are moving, which sets
 *   how dense the clatter is; clamped either way
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

  // Density is what makes this a table rather than a few chips -- below a
  // dozen or so the ear picks out individual knocks and counts them.
  const clacks = Math.max(18, Math.min(34, Math.round(chipCount * 8)));

  for (let index = 0; index < clacks; index += 1) {
    // Squared random, so the clatter is thickest as the rake takes hold and
    // thins as the chips come to rest -- an even spread is heard as a machine.
    const position = Math.random() ** 2;
    const at = start + position * RAKE_SECONDS;
    const fade = 1 - position * 0.55;
    scheduleClack(ctx, buffer, at, (0.055 + Math.random() * 0.045) * fade);
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
