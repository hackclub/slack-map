import type { SlackChannel } from './slack.js';

/**
 * Island growth and channel-chip packing.
 *
 * Replaces the old jittered-grid scatter, whose spacing constants were
 * grid-searched for at most 8 chips per island and had no guarantee beyond that.
 * Here chips are packed into rows: each chip owns a disjoint horizontal interval
 * within its row and rows occupy disjoint horizontal bands, so overlap is
 * impossible by construction at any channel count. The leftover space in both
 * directions is then handed out in random shares, which is what keeps the
 * result from reading as a grid — see splitRandom.
 */

export type Rect = { x: number; y: number; width: number; height: number };

export type PlacedChip = {
	channel: SlackChannel;
	/** Display text, truncated when the name is wider than its island. */
	label: string;
	/** Centre point, in viewBox units. */
	x: number;
	y: number;
	w: number;
	h: number;
	tilt: number;
};

/**
 * Ceiling on chips shown per island on the full map.
 *
 * Islands are NEVER resized to fit more channels. Scaling them about their
 * centroids destroyed the 15px coastline separation the layout was verified
 * against — every island pair overlapped and chips from different islands
 * collided on screen. Extra channels are revealed by opening an island instead,
 * where its contents can be dragged through in every direction (islandTiles.ts).
 */
export const MAX_CHIPS = 24;

/**
 * Most channels offered to one cell of an opened island (see islandTiles.ts).
 *
 * Not a visible limit: a page holds far fewer than this, and whatever doesn't
 * fit simply starts the next page. It only bounds how much row fitting is done
 * per page, so planning a zone of thousands stays cheap.
 */
export const MAX_CHIPS_ZOOMED = 400;

/**
 * Chip padding and inter-chip gaps, as multiples of the chip font.
 *
 * These used to be absolute viewBox units (19.2, 9, 10, 8). `fontUnits` shrinks
 * as you zoom in — chipFontUnits scales it — but those constants did not, so an
 * opened island modelled its chips at twice their drawn height with gaps wider
 * than the chips themselves, which is what left a zoomed island looking sparse.
 *
 * The ratios reproduce the old absolute values exactly at CHIP_FONT_UNITS = 12,
 * so the full map is unchanged; only zoomed levels get denser.
 */
const PAD_X_RATIO = 1.6; // was 19.2 absolute
const PAD_Y_RATIO = 0.75; // was 9
const GAP_X_RATIO = 10 / 12;
const GAP_Y_RATIO = 8 / 12;

/**
 * Total spread of the cosmetic chip tilt, in degrees (so +/- half of this).
 *
 * The packer works in axis-aligned boxes, but a tilted chip sweeps a taller box
 * than its own height: `h * cos + w * sin`. Chips are wide, so at 3.5 degrees a
 * long name reaches about 6% of its width above and below its unrotated edge.
 * At full-map spacing there was enough slack to absorb that; packed tight in a
 * zoomed island there is not, and chips genuinely clipped each other. The
 * allowance below is folded into every chip's measured height so the packer
 * reserves the room the tilt actually uses.
 */
const TILT_RANGE_DEG = 7;
const TILT_SIN = Math.sin(((TILT_RANGE_DEG / 2) * Math.PI) / 180);

/** Gaps for one zoom level, threaded through so nothing reads a stale constant. */
type Spacing = { x: number; y: number };

function spacingFor(fontUnits: number): Spacing {
	return { x: fontUnits * GAP_X_RATIO, y: fontUnits * GAP_Y_RATIO };
}

/**
 * Share of the leftover vertical space given to per-row bands rather than to
 * the gaps between rows. Higher scatters chips within a row further up and
 * down; lower spreads the rows themselves further apart.
 */
const BAND_SHARE = 0.55;

/**
 * Share of an island's height held back from row packing so the chips have
 * somewhere to scatter into.
 *
 * A packed island has almost no vertical slack of its own — community fitted
 * seven rows into 263 units, leaving about 47 to share between them — and with
 * that little room every chip is boxed in by its neighbours, so no amount of
 * jittering moves anything. Holding some back is what buys the scatter, and it
 * costs channels: each step up drops roughly one row per island.
 *
 * It used to be 0.22, back when a random jitter was the only thing spreading
 * chips out and it needed the elbow room. spreadEvenly redistributes far better
 * for the same space, so most of that reserve could go back to showing
 * channels — 47 chips to 52 — without the layout clumping again.
 */
const SCATTER_SHARE = 0.1;

/**
 * Split `total` into `parts` non-negative pieces of random size.
 *
 * Used to hand out packing slack as gaps. Because every piece is >= 0 and they
 * sum to exactly `total`, distributing them can only push chips apart, never
 * together — so the packer's non-overlap guarantee survives the scatter.
 */
/**
 * How far a chip may try to travel, in multiples of its own size, and how many
 * times each one gets to try. More passes means a looser scatter; the cost is
 * only paid when the packing changes, never per frame.
 */
const SCRAMBLE_PASSES = 4;
const SCRAMBLE_REACH_Y = 2.2;
const SCRAMBLE_REACH_X = 0.6;

/**
 * Fractions of the desired move to try, largest first.
 *
 * Offering only the full move almost never worked: chips are wide relative to
 * their island, so nearly every pair in neighbouring rows overlaps horizontally
 * and the full-size proposal always landed on something. Retrying the same
 * direction at decreasing size lets a boxed-in chip still take the few units it
 * does have, which is what actually breaks up the shared baseline.
 */
const SCRAMBLE_STEPS = [1, 0.72, 0.5, 0.32, 0.18, 0.08];

function clampTo(value: number, min: number, max: number) {
	return min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max);
}

/** Would a chip at (x, y) come within the gaps of `other`? */
function overlaps(
	other: PlacedChip,
	x: number,
	y: number,
	w: number,
	h: number,
	spacing: Spacing
) {
	return (
		Math.abs(x - other.x) < (w + other.w) / 2 + spacing.x &&
		Math.abs(y - other.y) < (h + other.h) / 2 + spacing.y
	);
}

type Grid = {
	/** Would a chip at (x, y) touch anything other than the one at `skip`? */
	hits: (skip: number, x: number, y: number, w: number, h: number) => boolean;
	/** Re-file a chip after it has been moved. */
	move: (index: number, x: number, y: number) => void;
};

/**
 * Uniform grid over the packed chips, so a collision query looks at a handful of
 * neighbours instead of every other chip.
 *
 * The check used to be a linear scan. That is fine for the couple of dozen chips
 * a closed island shows, but it runs inside two relaxation loops — so the work
 * is quadratic in the chip count, and it all lands in the frame where the island
 * opens. An open island now packs its whole zone, which for community is several
 * hundred channels.
 *
 * Cells are sized to the widest chip plus its gap. A query's reach is at most
 * `(w + maxW) / 2 + gap`, which cannot exceed one cell, so every possible
 * collider lies in the 3x3 block around the query and anything further away is
 * provably out of range.
 */
function buildGrid(chips: PlacedChip[], area: Rect, spacing: Spacing): Grid {
	let maxW = 0;
	let maxH = 0;
	for (const chip of chips) {
		if (chip.w > maxW) maxW = chip.w;
		if (chip.h > maxH) maxH = chip.h;
	}

	const cellW = Math.max(1, maxW + spacing.x);
	const cellH = Math.max(1, maxH + spacing.y);
	// A cell of margin each side, so a chip sitting exactly on the boundary still
	// files into a real cell rather than being clamped into its neighbour's.
	const originX = area.x - cellW;
	const originY = area.y - cellH;
	const cols = Math.ceil(area.width / cellW) + 3;
	const rows = Math.ceil(area.height / cellH) + 3;

	const cells: number[][] = Array.from({ length: cols * rows }, () => []);
	const colOf = (x: number) =>
		Math.min(cols - 1, Math.max(0, Math.floor((x - originX) / cellW)));
	const rowOf = (y: number) =>
		Math.min(rows - 1, Math.max(0, Math.floor((y - originY) / cellH)));

	const at = new Int32Array(chips.length);
	chips.forEach((chip, i) => {
		const key = rowOf(chip.y) * cols + colOf(chip.x);
		cells[key].push(i);
		at[i] = key;
	});

	return {
		hits(skip, x, y, w, h) {
			const cx = colOf(x);
			const cy = rowOf(y);

			for (let gy = Math.max(0, cy - 1); gy <= Math.min(rows - 1, cy + 1); gy++) {
				for (let gx = Math.max(0, cx - 1); gx <= Math.min(cols - 1, cx + 1); gx++) {
					for (const j of cells[gy * cols + gx]) {
						if (j === skip) continue;
						if (overlaps(chips[j], x, y, w, h, spacing)) return true;
					}
				}
			}

			return false;
		},

		move(index, x, y) {
			const key = rowOf(y) * cols + colOf(x);
			if (key === at[index]) return;

			const from = cells[at[index]];
			const pos = from.indexOf(index);
			if (pos >= 0) from.splice(pos, 1);

			cells[key].push(index);
			at[index] = key;
		}
	};
}


/**
 * Shake the packed chips off their rows.
 *
 * Row packing leaves the chips in neat lines, and a dense island has almost no
 * vertical slack to jitter them with — reserving enough would mean dropping
 * whole rows of channels. This instead starts from the packed layout, which is
 * already known to be collision-free, and repeatedly offers each chip a random
 * new spot, taking it only when nothing is in the way. Because every accepted
 * move preserves the invariant, the result is always valid: chips with room
 * scatter, chips in tight corners simply stay where the packer put them, and no
 * channel is lost either way.
 *
 * Chips within a row already own disjoint horizontal intervals, so most of them
 * are free to move vertically even when the island is full — which is where the
 * scatter comes from.
 */
function scramble(chips: PlacedChip[], area: Rect, zoneKey: string, grid: Grid) {
	for (let pass = 0; pass < SCRAMBLE_PASSES; pass++) {
		for (let i = 0; i < chips.length; i++) {
			const chip = chips[i];
			const seed = hashString(`${zoneKey}:${chip.channel.name}:${pass}`);

			const wantX = (seededRandom(seed) - 0.5) * 2 * chip.w * SCRAMBLE_REACH_X;
			const wantY = (seededRandom(seed ^ 0x51ed270b) - 0.5) * 2 * chip.h * SCRAMBLE_REACH_Y;

			for (const step of SCRAMBLE_STEPS) {
				const x = clampTo(
					chip.x + wantX * step,
					area.x + chip.w / 2,
					area.x + area.width - chip.w / 2
				);
				const y = clampTo(
					chip.y + wantY * step,
					area.y + chip.h / 2,
					area.y + area.height - chip.h / 2
				);

				if (grid.hits(i, x, y, chip.w, chip.h)) continue;

				chip.x = x;
				chip.y = y;
				grid.move(i, x, y);
				break;
			}
		}
	}
}

/**
 * Even out the spacing, once the chips are off their rows.
 *
 * A purely random scatter clumps: nothing in it knows how crowded a spot is, so
 * it will happily drop a chip into a huddle and leave half an island bare. This
 * is Lloyd's relaxation. The island is sampled on a grid, each sample is charged
 * to whichever chip is nearest, and each chip then steps toward the middle of
 * the region it owns. Crowded chips own little and get pushed apart; a chip
 * beside empty space owns a lot and drifts into it. Repeated, that settles into
 * even spacing which still looks scattered rather than gridded, because it
 * starts from the scattered layout instead of a lattice.
 *
 * Moves go through the same collision check as everything else, so evening out
 * the spacing can never introduce an overlap. It is deterministic — no random
 * numbers at all — so the server and the browser still agree.
 */
const RELAX_PASSES = 6;
const RELAX_RATE = 0.6;
const RELAX_COLS = 26;
const RELAX_ROWS = 20;

/**
 * Fewest samples a chip needs before the centre of its region means anything.
 *
 * The sampler is a fixed grid, so past a few hundred chips each one owns barely
 * a sample and its "centroid" is just that sample's own position — the pass
 * costs passes x samples x chips distance tests and then moves chips almost at
 * random. A canvas that full has nothing to even out anyway: the rows already
 * fill it and every move still has to clear the collision check. Skipping it
 * there took opening the community island from a 236ms frame to a smooth one.
 */
const RELAX_MIN_SAMPLES_PER_CHIP = 3;

function spreadEvenly(chips: PlacedChip[], area: Rect, grid: Grid) {
	if (chips.length < 2) return;
	if ((RELAX_COLS * RELAX_ROWS) / chips.length < RELAX_MIN_SAMPLES_PER_CHIP) return;

	const sumX = new Float64Array(chips.length);
	const sumY = new Float64Array(chips.length);
	const count = new Int32Array(chips.length);

	for (let pass = 0; pass < RELAX_PASSES; pass++) {
		sumX.fill(0);
		sumY.fill(0);
		count.fill(0);

		for (let gy = 0; gy < RELAX_ROWS; gy++) {
			const sy = area.y + ((gy + 0.5) / RELAX_ROWS) * area.height;

			for (let gx = 0; gx < RELAX_COLS; gx++) {
				const sx = area.x + ((gx + 0.5) / RELAX_COLS) * area.width;

				let best = 0;
				let bestDistance = Infinity;

				for (let i = 0; i < chips.length; i++) {
					const dx = sx - chips[i].x;
					const dy = sy - chips[i].y;
					const distance = dx * dx + dy * dy;
					if (distance < bestDistance) {
						bestDistance = distance;
						best = i;
					}
				}

				sumX[best] += sx;
				sumY[best] += sy;
				count[best]++;
			}
		}

		for (let i = 0; i < chips.length; i++) {
			if (!count[i]) continue;

			const chip = chips[i];
			const wantX = (sumX[i] / count[i] - chip.x) * RELAX_RATE;
			const wantY = (sumY[i] / count[i] - chip.y) * RELAX_RATE;

			for (const step of SCRAMBLE_STEPS) {
				const x = clampTo(
					chip.x + wantX * step,
					area.x + chip.w / 2,
					area.x + area.width - chip.w / 2
				);
				const y = clampTo(
					chip.y + wantY * step,
					area.y + chip.h / 2,
					area.y + area.height - chip.h / 2
				);

				if (grid.hits(i, x, y, chip.w, chip.h)) continue;

				chip.x = x;
				chip.y = y;
				grid.move(i, x, y);
				break;
			}
		}
	}
}



function splitRandom(total: number, parts: number, seed: number): number[] {
	if (parts <= 0) return [];
	if (total <= 0) return new Array(parts).fill(0);

	const weights: number[] = [];
	let sum = 0;

	for (let i = 0; i < parts; i++) {
		// The floor stops any one gap collapsing to nothing and caps how lopsided
		// the split can get. It was 0.25, which let one gap take five times another
		// and opened visible holes between bunched-up rows.
		const weight = 0.6 + seededRandom(seed ^ Math.imul(i + 1, 0x9e3779b9));
		weights.push(weight);
		sum += weight;
	}

	return weights.map((weight) => (weight / sum) * total);
}

function hashString(value: string) {
	let hash = 2166136261;
	for (let i = 0; i < value.length; i++) {
		hash ^= value.charCodeAt(i);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}

/** mulberry32 — deterministic, so SSR and the client agree. */
function seededRandom(seed: number) {
	let t = (seed + 0x6d2b79f5) | 0;
	t = Math.imul(t ^ (t >>> 15), t | 1);
	t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Scale every coordinate pair in an SVG path about a fixed point. Works because
 * these paths are only M and C commands, where every number is a coordinate.
 */
export function scalePath(d: string, cx: number, cy: number, k: number) {
	if (k === 1) return d;

	let index = 0;
	return d.replace(/-?\d+(?:\.\d+)?/g, (match) => {
		const value = Number(match);
		const scaled = index % 2 === 0 ? cx + (value - cx) * k : cy + (value - cy) * k;
		index++;
		return scaled.toFixed(1);
	});
}

/**
 * Chip size expressed in viewBox units for a given zoom level.
 *
 * Chips render at a fixed CSS pixel size, so as the viewBox narrows each chip
 * covers proportionally fewer viewBox units — which is exactly why a zoomed
 * island fits many more of them without anything moving.
 */
export function chipFontUnits(baseUnits: number, viewBoxWidth: number, fullWidth = 1100) {
	return baseUnits * (viewBoxWidth / fullWidth);
}

/**
 * Estimated chip box in viewBox units. Kept in sync with `.zone-channel`'s
 * font-size and padding — restyle the chip and this needs revisiting, or the
 * spacing drifts.
 */
export function measureChip(name: string, fontUnits: number) {
	const w = `#${name}`.length * fontUnits * 0.62 + fontUnits * PAD_X_RATIO;

	return {
		w,
		// Includes the room the tilt sweeps, which depends on how wide the chip is.
		h: fontUnits * 1.15 + fontUnits * PAD_Y_RATIO + w * TILT_SIN
	};
}

/**
 * Fit a chip label to a maximum width.
 *
 * Row-breaking cannot help when a single name is wider than the whole island —
 * `software` is only ~215 units across once grown, and long names such as
 * `#what-is-my-slack-id` overflow its coastline. Truncating is what keeps every
 * chip inside its island.
 */
function fitLabel(name: string, fontUnits: number, maxWidth: number) {
	const full = `#${name}`;
	const charWidth = fontUnits * 0.62;
	const usable = maxWidth - fontUnits * PAD_X_RATIO;

	if (full.length * charWidth <= usable) return full;

	const chars = Math.max(3, Math.floor(usable / charWidth) - 1);
	return `${full.slice(0, chars)}…`;
}

export type PackResult = {
	chips: PlacedChip[];
	overflow: number;
};

/**
 * Bands at the top and bottom of the label area that chips must keep clear.
 *
 * The zone title is pinned to the top of the area. Packing across the full
 * height put chips straight underneath it — the heading became unreadable
 * against the first row of chips.
 */
export type Reserve = { top: number; bottom: number };

type RowItem = { channel: SlackChannel; label: string; w: number; h: number; tilt: number };
type Row = { items: RowItem[]; w: number; h: number };

/** The part of `fullArea` chips are laid out in, once the reserved bands are taken off. */
function innerArea(fullArea: Rect, reserve: Reserve, fontUnits: number): Rect {
	return {
		x: fullArea.x,
		y: fullArea.y + reserve.top,
		width: fullArea.width,
		height: Math.max(fontUnits * 2, fullArea.height - reserve.top - reserve.bottom)
	};
}

/**
 * Break channels into rows that each fit the area's width, then keep as many
 * rows as fit its height.
 *
 * Shared by packChips and countFitting so the two can never disagree about how
 * many channels an area holds. That agreement is what lets islandTiles.ts hand
 * each cell exactly the channels it will place, so none fall between cells.
 */
function fitRows(
	zoneKey: string,
	channels: SlackChannel[],
	area: Rect,
	fontUnits: number,
	spacing: Spacing
) {
	const rows: Row[] = [];
	let row: Row = { items: [], w: 0, h: 0 };

	for (const channel of channels) {
		const label = fitLabel(channel.name, fontUnits, area.width);
		// Tilt is derived from the channel name alone, so it is known here, before
		// anything is placed. Reserving each chip's own sweep rather than the
		// worst case matters: the average |tilt| is half the maximum, and charging
		// every chip the maximum cost ten channels on the full map for room only
		// the most-tilted ones ever use.
		const seed = hashString(`${zoneKey}:${channel.name}`);
		const tilt = Number(
			((seededRandom(seed ^ 0x85ebca6b) - 0.5) * TILT_RANGE_DEG).toFixed(2)
		);
		// Measured from the truncated label, not the full name — a chip that got
		// shortened must not keep reserving the room its full name needed.
		const w = label.length * fontUnits * 0.62 + fontUnits * PAD_X_RATIO;
		const h =
			fontUnits * 1.15 +
			fontUnits * PAD_Y_RATIO +
			w * Math.sin((Math.abs(tilt) * Math.PI) / 180);
		const widthIfAdded = row.items.length ? row.w + spacing.x + w : w;

		if (widthIfAdded > area.width && row.items.length) {
			rows.push(row);
			row = { items: [], w: 0, h: 0 };
		}

		row.items.push({ channel, label, w, h, tilt });
		row.w = row.items.length === 1 ? w : row.w + spacing.x + w;
		row.h = Math.max(row.h, h);
	}
	if (row.items.length) rows.push(row);

	// A narrow island produces one chip per row, and those rows can easily exceed
	// its height — `software` is only ~143 units wide. Drop the rows that do not
	// fit rather than letting chips spill past the coastline. The first row is
	// always kept, so every area places at least one chip.
	const packHeight = area.height * (1 - SCATTER_SHARE);
	let fitted = 0;
	let usedHeight = 0;

	for (const r of rows) {
		const next = usedHeight ? usedHeight + spacing.y + r.h : r.h;
		if (next > packHeight && fitted > 0) break;
		usedHeight = next;
		fitted++;
	}

	rows.length = fitted;
	return { rows, usedHeight };
}

/**
 * How many channels, taken from the front of `channels`, packChips would place
 * in `fullArea` with the same arguments.
 *
 * Runs only the row fitting, none of the scatter, so it is cheap enough to plan
 * every page of a zone with thousands of channels up front.
 */
export function countFitting(
	zoneKey: string,
	channels: SlackChannel[],
	fullArea: Rect,
	fontUnits: number,
	reserve: Reserve = { top: 0, bottom: 0 }
) {
	const spacing = spacingFor(fontUnits);
	const area = innerArea(fullArea, reserve, fontUnits);
	const { rows } = fitRows(zoneKey, channels, area, fontUnits, spacing);
	return rows.reduce((count, r) => count + r.items.length, 0);
}

export function packChips(
	zoneKey: string,
	channels: SlackChannel[],
	fullArea: Rect,
	fontUnits: number,
	maxChips: number = MAX_CHIPS,
	reserve: Reserve = { top: 0, bottom: 0 }
): PackResult {
	// Gaps scale with the font, so a smaller chip font gets tighter gaps too.
	// Derived once and passed down, so no helper can fall back on a full-map
	// constant while packing an opened island.
	const spacing = spacingFor(fontUnits);

	// Chips are laid out inside the area minus the reserved bands; callers still
	// position them against `fullArea`, so the coordinates stay comparable.
	const area = innerArea(fullArea, reserve, fontUnits);

	const visible = channels.slice(0, maxChips);
	const { rows, usedHeight } = fitRows(zoneKey, visible, area, fontUnits, spacing);
	const overflow = channels.length - rows.reduce((count, r) => count + r.items.length, 0);

	if (!rows.length) return { chips: [], overflow };

	const slackY = Math.max(0, area.height - usedHeight);

	// The leftover space is split two ways: part widens the band each row gets,
	// so chips within a row can sit at different heights, and the rest becomes
	// the gaps between rows, so the rows are not evenly spaced either. Handing
	// it all to the leads is what made the rows legible as rows.
	const bandBudget = slackY * BAND_SHARE;
	const bands = splitRandom(bandBudget, rows.length, hashString(`${zoneKey}:bands`));
	const leads = splitRandom(slackY - bandBudget, rows.length + 1, hashString(`${zoneKey}:leads`));

	const chips: PlacedChip[] = [];
	let y = area.y + leads[0];

	rows.forEach((current, rowIndex) => {
		// The row's own slice of vertical space. Bands are laid end to end and
		// never overlap, so a chip jittered inside one can never reach into a
		// neighbouring row.
		const band = current.h + bands[rowIndex];

		const slackX = Math.max(0, area.width - current.w);
		// One share before the first chip, one after the last, one between each
		// pair. Every share is >= 0 and they sum to the row's measured slack, so
		// this only ever pushes chips further apart — the disjoint-interval
		// argument that rules out overlap still holds.
		const gaps = splitRandom(
			slackX,
			current.items.length + 1,
			hashString(`${zoneKey}:row:${rowIndex}`)
		);

		let x = area.x + gaps[0];

		current.items.forEach((item, i) => {
			const seed = hashString(`${zoneKey}:${item.channel.name}`);
			// How far this chip may travel inside its band.
			const travel = Math.max(0, band - item.h);

			chips.push({
				channel: item.channel,
				label: item.label,
				x: x + item.w / 2,
				y: y + item.h / 2 + seededRandom(seed ^ 0x9e3779b9) * travel,
				w: item.w,
				h: item.h,
				// The same tilt its height was measured against, so the room
				// reserved for the sweep is the room the sweep actually uses.
				tilt: item.tilt
			});

			// spacing.x stays as the floor so a small random share cannot let two
			// chips touch; the share is what varies the spacing.
			x += item.w + spacing.x + gaps[i + 1];
		});

		y += band + spacing.y + leads[rowIndex + 1];
	});

	// The rows have done their job — they proved a valid arrangement exists.
	// Break them up now that the chips no longer need to be in lines. Bounded by
	// `area`, not `fullArea`, so the scatter cannot push a chip up under the zone
	// title or down past the bottom edge.
	// Both relaxation passes query and update the same grid, so the neighbour
	// lookups stay cheap however many chips an area holds.
	const grid = buildGrid(chips, area, spacing);
	scramble(chips, area, zoneKey, grid);

	// ...then even out what the random pass left clumped.
	spreadEvenly(chips, area, grid);

	return { chips, overflow };
}
