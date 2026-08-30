import type { SlackChannel } from './slack.js';

/**
 * Island growth and channel-chip packing.
 *
 * Replaces the old jittered-grid scatter, whose spacing constants were
 * grid-searched for at most 8 chips per island and had no guarantee beyond that.
 * Here chips are packed into rows: each chip owns a disjoint horizontal interval
 * within its row and rows are vertically disjoint, so overlap is impossible by
 * construction at any channel count.
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

export function packChips(
	zoneKey: string,
	channels: SlackChannel[],
	area: Rect,
	fontUnits: number,
	maxChips: number = MAX_CHIPS
): PackResult {
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

	for (const r of rows) {
		const next = usedHeight ? usedHeight + GAP_Y + r.h : r.h;
		if (next > area.height && fitted > 0) break;
		usedHeight = next;
		fitted++;
	}

	for (const r of rows.slice(fitted)) dropped += r.items.length;
	rows.length = fitted;

	const rowsHeight = usedHeight;
	const slackY = Math.max(0, area.height - rowsHeight);
	const leadY = slackY / (rows.length + 1);

	const chips: PlacedChip[] = [];
	let y = area.y + leadY;

	for (const current of rows) {
		const slackX = Math.max(0, area.width - current.w);
		// Jitter is bounded by the row's own measured slack, so the scattered look
		// never costs us the non-overlap guarantee.
		const jitterX = Math.min(slackX / Math.max(1, current.items.length), GAP_X);
		const jitterY = Math.min(GAP_Y, leadY);

		let x = area.x + slackX / 2;

		for (const item of current.items) {
			const seed = hashString(`${zoneKey}:${item.channel.name}`);
			chips.push({
				channel: item.channel,
				label: item.label,
				x: x + item.w / 2 + (seededRandom(seed) - 0.5) * jitterX,
				y: y + current.h / 2 + (seededRandom(seed ^ 0x9e3779b9) - 0.5) * jitterY,
				w: item.w,
				h: item.h,
				tilt: Number(((seededRandom(seed ^ 0x85ebca6b) - 0.5) * 7).toFixed(2))
			});
			x += item.w + GAP_X;
		}

		y += current.h + GAP_Y + leadY;
	}

	return { chips, overflow: overflow + dropped };
}
