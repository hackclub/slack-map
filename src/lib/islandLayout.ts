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
 * Ceiling on chips rendered per island; the rest become a "+N more" count.
 *
 * Islands are NEVER resized to fit more channels. Scaling them about their
 * centroids destroyed the 15px coastline separation the layout was verified
 * against — every island pair overlapped and chips from different islands
 * collided on screen. Extra channels are revealed by zooming into an island
 * instead, which enlarges its area on screen without moving any coastline.
 */
export const MAX_CHIPS = 24;

/** Zooming into one island gives it the whole viewport, so far more fits. */
export const MAX_CHIPS_ZOOMED = 150;

const GAP_X = 10;
const GAP_Y = 8;

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
 * This is the one genuine trade in the layout. A packed island has almost no
 * vertical slack — community fitted seven rows into 263 units, leaving about 47
 * to share between them — and with that little room every chip is boxed in by
 * its neighbours, so no amount of jittering moves anything. Buying scatter means
 * giving up roughly one row per island.
 */
const SCATTER_SHARE = 0.22;

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

/** Would a chip at (x, y) come within the gaps of any chip other than `skip`? */
function hits(chips: PlacedChip[], skip: number, x: number, y: number, w: number, h: number) {
	for (let j = 0; j < chips.length; j++) {
		if (j === skip) continue;
		const other = chips[j];
		if (
			Math.abs(x - other.x) < (w + other.w) / 2 + GAP_X &&
			Math.abs(y - other.y) < (h + other.h) / 2 + GAP_Y
		) {
			return true;
		}
	}
	return false;
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
function scramble(chips: PlacedChip[], area: Rect, zoneKey: string) {
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

				if (hits(chips, i, x, y, chip.w, chip.h)) continue;

				chip.x = x;
				chip.y = y;
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
		// The floor stops any one gap collapsing to nothing, which would read as
		// two chips stuck together rather than as scatter.
		const weight = 0.25 + seededRandom(seed ^ Math.imul(i + 1, 0x9e3779b9));
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
	return {
		w: `#${name}`.length * fontUnits * 0.62 + 19.2,
		h: fontUnits * 1.15 + 9
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
	const usable = maxWidth - 19.2;

	if (full.length * charWidth <= usable) return full;

	const chars = Math.max(3, Math.floor(usable / charWidth) - 1);
	return `${full.slice(0, chars)}…`;
}

export type PackResult = { chips: PlacedChip[]; overflow: number };

/**
 * Bands at the top and bottom of the label area that chips must keep clear.
 *
 * The zone title is pinned to the top of the area and the "+N more" badge to
 * the bottom. Packing across the full height put chips straight underneath both
 * — the heading became unreadable against the first row of chips.
 */
export type Reserve = { top: number; bottom: number };

export function packChips(
	zoneKey: string,
	channels: SlackChannel[],
	fullArea: Rect,
	fontUnits: number,
	maxChips: number = MAX_CHIPS,
	reserve: Reserve = { top: 0, bottom: 0 }
): PackResult {
	// Chips are laid out inside the area minus the reserved bands; callers still
	// position them against `fullArea`, so the coordinates stay comparable.
	const area: Rect = {
		x: fullArea.x,
		y: fullArea.y + reserve.top,
		width: fullArea.width,
		height: Math.max(fontUnits * 2, fullArea.height - reserve.top - reserve.bottom)
	};

	const visible = channels.slice(0, maxChips);
	const overflow = channels.length - visible.length;

	type Item = { channel: SlackChannel; label: string; w: number; h: number };
	type Row = { items: Item[]; w: number; h: number };

	const rows: Row[] = [];
	let row: Row = { items: [], w: 0, h: 0 };

	for (const channel of visible) {
		const label = fitLabel(channel.name, fontUnits, area.width);
		const { h } = measureChip(channel.name, fontUnits);
		const w = label.length * fontUnits * 0.62 + 19.2;
		const widthIfAdded = row.items.length ? row.w + GAP_X + w : w;

		if (widthIfAdded > area.width && row.items.length) {
			rows.push(row);
			row = { items: [], w: 0, h: 0 };
		}

		row.items.push({ channel, label, w, h });
		row.w = row.items.length === 1 ? w : row.w + GAP_X + w;
		row.h = Math.max(row.h, h);
	}
	if (row.items.length) rows.push(row);

	if (!rows.length) return { chips: [], overflow };

	// A narrow island produces one chip per row, and those rows can easily exceed
	// its height — `software` is only ~215 units wide. Drop the rows that do not
	// fit and count them as overflow, rather than letting chips spill past the
	// coastline.
	let fitted = 0;
	let usedHeight = 0;
	let dropped = 0;

	// Rows are fitted into less than the full height; the rest is the scatter
	// budget, spent below on bands and leads. Slack is still measured against the
	// real height, so the space held back here is exactly what the chips get to
	// move around in.
	const packHeight = area.height * (1 - SCATTER_SHARE);

	for (const r of rows) {
		const next = usedHeight ? usedHeight + GAP_Y + r.h : r.h;
		if (next > packHeight && fitted > 0) break;
		usedHeight = next;
		fitted++;
	}

	for (const r of rows.slice(fitted)) dropped += r.items.length;
	rows.length = fitted;

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
				tilt: Number(((seededRandom(seed ^ 0x85ebca6b) - 0.5) * 7).toFixed(2))
			});

			// GAP_X stays as the floor so a small random share cannot let two
			// chips touch; the share is what varies the spacing.
			x += item.w + GAP_X + gaps[i + 1];
		});

		y += band + GAP_Y + leads[rowIndex + 1];
	});

	// The rows have done their job — they proved a valid arrangement exists.
	// Break them up now that the chips no longer need to be in lines. Bounded by
	// `area`, not `fullArea`, so the scatter cannot push a chip up under the zone
	// title or down past the bottom edge.
	scramble(chips, area, zoneKey);

	return { chips, overflow: overflow + dropped };
}
