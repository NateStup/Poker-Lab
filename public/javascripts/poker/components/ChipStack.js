/**
 * A wager drawn as a stack of casino chips.
 *
 * The chips are SVG rather than styled `div`s for the same reason the logo and
 * the back arrow are: a chip is a *shape* -- an ellipse seen from across the
 * table, with a side wall under it -- and CSS can only fake that by stacking
 * circles, which is what the first version did and why a stack read as one
 * icon printed several times rather than as chips.
 *
 * The drawing is a cylinder per chip: a side wall, and a face on the top one.
 * Only the top chip's face is drawn, because each chip's wall and face exactly
 * cover the face of the chip below it -- the wall of chip N spans from the
 * front arc of its own face down to the front arc of chip N-1's face, so the
 * two together tile the silhouette with nothing showing through and nothing
 * painted twice.
 *
 * The colour bands running down the side walls are the one detail that sells
 * it at this size: real chips carry edge spots, they line up when the stack is
 * neat, and a vertical stripe down the side of a stack is what the eye reads
 * as "these are separate chips" long before it can count them.
 */

const e = React.createElement;

/**
 * How a wager is drawn, in big blinds.
 *
 * Height and colour come out of the same table on purpose. Height alone tops
 * out -- past a handful of chips a stack can't get meaningfully taller without
 * running off the felt -- so the colour carries the reading from there, the
 * way a real denomination does: five purple chips and five black ones are
 * plainly different bets, five of an identical chip are not.
 *
 * A single chip still means "nothing has happened here yet": a blind, an ante,
 * a limp, a min bet.
 */
const CHIP_TIERS = Object.freeze([
  Object.freeze({ maxBlinds: 1, count: 1, tone: 'white' }),
  Object.freeze({ maxBlinds: 3, count: 2, tone: 'red' }),
  Object.freeze({ maxBlinds: 8, count: 3, tone: 'green' }),
  Object.freeze({ maxBlinds: 20, count: 4, tone: 'black' }),
  Object.freeze({ maxBlinds: Infinity, count: 5, tone: 'purple' })
]);

/**
 * Chip palettes, in the order a casino racks them: white, red, green, black,
 * purple. Each tone names the six surfaces the drawing needs -- the wall's
 * base and its darkened rims, the edge spots, the face's ring, its inlay, and
 * the hairline between them.
 */
const CHIP_TONES = Object.freeze({
  white: Object.freeze({ shade: '#a8b2c0', edge: '#dbe2ea', spot: '#475569', face: '#eef2f7', inlay: '#ffffff', line: '#94a3b8' }),
  red: Object.freeze({ shade: '#7f1d1d', edge: '#b91c1c', spot: '#f1f5f9', face: '#c1332b', inlay: '#dc4a3d', line: '#7f1d1d' }),
  green: Object.freeze({ shade: '#14532d', edge: '#15803d', spot: '#f1f5f9', face: '#16a34a', inlay: '#22c55e', line: '#14532d' }),
  black: Object.freeze({ shade: '#0b0f16', edge: '#1f2937', spot: '#f1f5f9', face: '#273142', inlay: '#374151', line: '#0b0f16' }),
  purple: Object.freeze({ shade: '#3b0764', edge: '#6d28d9', spot: '#f1f5f9', face: '#7c3aed', inlay: '#8b5cf6', line: '#3b0764' })
});

/* Geometry, in user units. `RY` against `RX` is the viewing angle: the flatter
   the ellipse, the lower the camera. These want to stay in one place -- the
   face, the wall and the viewBox are all derived from them, and splitting any
   of it into the stylesheet would put the chips out of their own box the first
   time either side was edited alone. */
const RX = 15;
const RY = 5.2;
const THICKNESS = 4.6;
const PAD = 1.4;
const CX = RX + PAD;
const WIDTH = CX * 2;

/**
 * The wall's colour across its width: darkened at both rims (which is what
 * makes it read as curved) with three edge spots between them. Each entry is
 * where that band ends, 0 to 1, and which tone colour paints it.
 */
const EDGE_BANDS = Object.freeze([
  Object.freeze([0.07, 'shade']),
  Object.freeze([0.21, 'edge']),
  Object.freeze([0.34, 'spot']),
  Object.freeze([0.45, 'edge']),
  Object.freeze([0.55, 'spot']),
  Object.freeze([0.66, 'edge']),
  Object.freeze([0.79, 'spot']),
  Object.freeze([0.93, 'edge']),
  Object.freeze([1, 'shade'])
]);

/** Where the face's edge spots sit, in degrees around it. */
const FACE_SPOT_ANGLES = Object.freeze([30, 90, 150, 210, 270, 330]);

/**
 * @param {number} amount chips in front of the seat
 * @param {number} bigBlind the hand's big blind; 0 when unknown, which leaves
 *   nothing to size the wager against, so it draws as a single chip
 * @returns {{count: number, tone: string}}
 */
function tierFor(amount, bigBlind) {
  if (!(bigBlind > 0)) return CHIP_TIERS[0];

  const blinds = amount / bigBlind;
  return CHIP_TIERS.find(tier => blinds <= tier.maxBlinds) || CHIP_TIERS[CHIP_TIERS.length - 1];
}

/**
 * The visible side of one chip: the band between the front of its own face and
 * the front of the face below it, closed off by the straight sides.
 * @param {number} cy centre of this chip's top face
 * @returns {string} an SVG path
 */
function wallPath(cy) {
  return [
    `M ${CX - RX} ${cy}`,
    `L ${CX - RX} ${cy + THICKNESS}`,
    `A ${RX} ${RY} 0 0 0 ${CX + RX} ${cy + THICKNESS}`,
    `L ${CX + RX} ${cy}`,
    `A ${RX} ${RY} 0 0 1 ${CX - RX} ${cy}`,
    'Z'
  ].join(' ');
}

/**
 * Turn the band table into gradient stops. Each boundary gets two stops at the
 * same offset so the colour changes abruptly -- an edge spot is printed, not
 * blended, and a smooth gradient here reads as a smudge.
 * @param {object} tone an entry from `CHIP_TONES`
 * @returns {*[]} `<stop>` elements
 */
function edgeStops(tone) {
  const stops = [];
  let start = 0;

  for (const [end, key] of EDGE_BANDS) {
    stops.push(e('stop', { key: `${start}-a`, offset: start, stopColor: tone[key] }));
    stops.push(e('stop', { key: `${end}-b`, offset: end, stopColor: tone[key] }));
    start = end;
  }

  return stops;
}

/**
 * @param {object} props
 * @param {number} props.amount chips in front of the seat
 * @param {number} [props.bigBlind] the unit the wager is sized against
 */
export function ChipStack({ amount, bigBlind = 0 }) {
  // Gradients are referenced by id, and several seats can have chips out at
  // once; a per-instance suffix is what keeps two stacks from sharing one id.
  // React's ids carry colons, which are legal in an id but awkward inside
  // `url(#...)`, so they come out first.
  const uid = React.useId().replace(/:/g, '');
  const edgeId = `chip-edge-${uid}`;
  const shadowId = `chip-shadow-${uid}`;

  const { count, tone: toneName } = tierFor(amount, bigBlind);
  const tone = CHIP_TONES[toneName];

  const topFaceCy = PAD + RY;
  // Where the bottom chip meets the felt, and the room the contact shadow
  // needs under it.
  const base = topFaceCy + RY + THICKNESS * count;
  const height = base + RY * 1.1;

  return e(
    'svg',
    {
      className: 'chip-stack',
      viewBox: `0 0 ${WIDTH} ${height}`,
      width: WIDTH,
      height,
      role: 'presentation',
      'aria-hidden': 'true',
      focusable: 'false'
    },

    e(
      'defs',
      null,
      e(
        'linearGradient',
        { id: edgeId, x1: '0', y1: '0', x2: '1', y2: '0' },
        edgeStops(tone)
      ),
      // Soft rather than a flat blob: a hard-edged ellipse under the chips
      // looks like a second, darker chip.
      e(
        'radialGradient',
        { id: shadowId },
        e('stop', { offset: 0, stopColor: '#000', stopOpacity: 0.45 }),
        e('stop', { offset: 1, stopColor: '#000', stopOpacity: 0 })
      )
    ),

    e('ellipse', { cx: CX, cy: base, rx: RX * 1.1, ry: RY * 0.95, fill: `url(#${shadowId})` }),

    // Bottom chip first: each one above paints over the face of the one below.
    Array.from({ length: count }, (_unused, index) => {
      const cy = topFaceCy + (count - 1 - index) * THICKNESS;
      return e('path', {
        key: index,
        d: wallPath(cy),
        fill: `url(#${edgeId})`,
        stroke: 'rgba(0, 0, 0, 0.45)',
        strokeWidth: 0.5
      });
    }),

    e(
      'g',
      null,
      e('ellipse', {
        cx: CX, cy: topFaceCy, rx: RX, ry: RY,
        fill: tone.face, stroke: 'rgba(0, 0, 0, 0.45)', strokeWidth: 0.5
      }),
      FACE_SPOT_ANGLES.map(degrees => {
        const radians = (degrees * Math.PI) / 180;
        return e('ellipse', {
          key: degrees,
          cx: CX + RX * 0.78 * Math.cos(radians),
          cy: topFaceCy + RY * 0.78 * Math.sin(radians),
          rx: 2.3,
          ry: 1,
          fill: tone.spot
        });
      }),
      e('ellipse', {
        cx: CX, cy: topFaceCy, rx: RX * 0.62, ry: RY * 0.62,
        fill: tone.inlay, stroke: tone.line, strokeWidth: 0.5
      }),
      // The light catching the near edge of the face. Kept faint: at this size
      // anything stronger reads as a smear rather than a sheen.
      e('ellipse', {
        cx: CX - RX * 0.18, cy: topFaceCy - RY * 0.34, rx: RX * 0.42, ry: RY * 0.24,
        fill: '#ffffff', opacity: 0.14
      })
    )
  );
}
