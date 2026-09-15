import type { SlackChannel } from './slack.js';
import type { Offset } from './panzoom.js';
import {
	countFitting,
	packChips,
	MAX_CHIPS_ZOOMED,
	type PlacedChip,
	type Rect,
	type Reserve
} from './islandLayout.js';

/**
 * An opened island's contents as one bounded area, evenly filled.
 *
 * The area is a grid of pages, each one copy of the island's label box, sized to
 * hold the whole zone and kept roughly square on screen. The island opens on the
 * centre page, so there is room to drag in every direction until an edge.
 *
 * Every page gets about the same number of channels, so the density is even
 * across the whole area instead of full in the middle and thinning out towards
 * the edges. Pages are handed channels in spiral order out from the centre, so
 * the busiest channels are still where you land.
 *
 * Only pages overlapping the window are ever packed, and each is packed once, so
 * a zone of thousands of channels costs no more to drag through than one of fifty.
 */

export type TileField = {
	/** Offsets the content may be dragged to: the edges of the area. */
	min: Offset;
	max: Offset;
	/**
	 * Which pages overlap the window at `offset`, as a string key.
	 *
	 * A primitive on purpose: it only changes when a page boundary is crossed, so
	 * a reactive statement keyed on it re-runs a handful of times per drag rather
	 * than on every pointermove.
	 */
	visibleKey: (offset: Offset) => string;
	/** The chips for a key from `visibleKey`, packing any page not yet seen. */
	chipsFor: (key: string) => PlacedChip[];
};

/**
 * How much of a page past the window's edge counts as visible, as a fraction of
 * the page.
 *
 * Zero on purpose. Every chip sits inside its own page's margins, so a page
 * that isn't overlapping the window has nothing that could show — and it gets
 * drawn the moment its first sliver slides in, while that edge is still clipped
 * by the label box. Any lookahead at all pulls in all eight neighbours of the
 * page an island opens on, right in the frame the open animation starts.
 */
const LOOKAHEAD = 0;

/**
 * Share of a page's capacity each page is filled to.
 *
 * Filling pages to capacity front-loads the channels and leaves the last page
 * with whatever is left over — often a handful of chips on an otherwise empty
 * page at the edge. Sizing the area for a little under capacity gives every page
 * the same share, with room to absorb pages whose long names fit fewer chips.
 */
const FILL = 0.75;

/** Page position -> order in a square spiral out from (0, 0). */
function spiralIndex(tx: number, ty: number): number {
	const r = Math.max(Math.abs(tx), Math.abs(ty));
	if (r === 0) return 0;

	// Ring r holds indices (2r-1)^2 .. (2r+1)^2 - 1: 8r pages, 2r to a side.
	const base = (2 * r - 1) ** 2;
	if (tx === r && ty > -r) return base + (ty + r - 1);
	if (ty === r) return base + 2 * r + (r - 1 - tx);
	if (tx === -r) return base + 4 * r + (r - 1 - ty);
	return base + 6 * r + (tx + r - 1);
}

type Cell = { tx: number; ty: number };

export function createTileField(
	zoneKey: string,
	channels: SlackChannel[],
	area: Rect,
	fontUnits: number,
	/**
	 * A page's on-screen width over its height. The SVG stretches x and y
	 * independently, so this can't be read off `area`; it is what keeps the whole
	 * area square on screen rather than square in viewBox units.
	 */
	pageAspect = area.width / area.height
): TileField {
	// Half-font margins inside every page, so chips on either side of a page edge
	// still end up at least a full gap apart.
	const margin = fontUnits * 0.5;
	const reserve: Reserve = { top: margin, bottom: margin };

	function pageRect({ tx, ty }: Cell): Rect {
		return {
			x: area.x + tx * area.width + margin,
			y: area.y + ty * area.height,
			width: area.width - margin * 2,
			height: area.height
		};
	}

	// Each page gets its own seed, or every page would share one scatter pattern
	// and the area would visibly repeat. Planning and packing must use the same
	// key: tilt comes from it, and tilt changes how many chips fit.
	const seedFor = (index: number) => `${zoneKey}:page:${index}`;
	const size = pageRect({ tx: 0, ty: 0 });
	const total = channels.length;

	/**
	 * Hands every page of a cols x rows grid an equal share of what is left, in
	 * spiral order from the centre. Returns null if the channels don't all fit,
	 * which only happens when many pages hold fewer than their share.
	 */
	function distribute(cols: number, rows: number) {
		// Centred on page (0, 0), where the island opens.
		const txMin = -Math.floor((cols - 1) / 2);
		const tyMin = -Math.floor((rows - 1) / 2);

		const cells: Cell[] = [];
		for (let ty = tyMin; ty < tyMin + rows; ty++) {
			for (let tx = txMin; tx < txMin + cols; tx++) cells.push({ tx, ty });
		}
		cells.sort((a, b) => spiralIndex(a.tx, a.ty) - spiralIndex(b.tx, b.ty));

		// starts[i] is the first channel on page i; the last entry is where they ran out.
		const starts = [0];
		for (let i = 0; i < cells.length; i++) {
			const start = starts[i];
			const share = Math.ceil((total - start) / (cells.length - i));
			// fitRows keeps whole rows, so a page can take slightly less than its share.
			const fits = share
				? countFitting(seedFor(i), channels.slice(start, start + share), size, fontUnits, reserve)
				: 0;
			starts.push(start + fits);
		}

		if (starts[cells.length] < total) return null;
		return { cells, starts, txMin, tyMin, cols, rows };
	}

	// What one page holds, measured against a full page's worth of the zone's own
	// names — cycled if the zone is small. Measuring the zone as-is capped the
	// estimate at its channel count, so a seven-channel zone looked like a page
	// only holds seven and was spread thinly over two pages.
	const sample = total
		? Array.from({ length: MAX_CHIPS_ZOOMED }, (_, i) => channels[i % total])
		: [];
	const capacity = Math.max(1, countFitting(seedFor(0), sample, size, fontUnits, reserve));

	// Odd counts, so the page the island opens on is the true centre with as much
	// room to drag one way as the other. With two columns it sat against the left
	// edge and could only be dragged right.
	const odd = (count: number) => (count > 1 && count % 2 === 0 ? count + 1 : count);

	const wanted = Math.max(1, Math.ceil(total / (capacity * FILL)));
	let cols = odd(Math.max(1, Math.round(Math.sqrt(wanted / pageAspect))));
	let rows = odd(Math.max(1, Math.ceil(wanted / cols)));

	// Grow two at a time on whichever axis keeps the area squarer on screen, until
	// the whole zone fits. Every page always fits at least one row, so this ends.
	let plan = distribute(cols, rows);
	while (!plan) {
		if (cols * pageAspect <= rows) cols += 2;
		else rows += 2;
		plan = distribute(cols, rows);
	}

	const { cells, starts, txMin, tyMin } = plan;
	const indexAt = new Map(cells.map((cell, i) => [`${cell.tx},${cell.ty}`, i]));
	const cache = new Map<number, PlacedChip[]>();

	function page(index: number) {
		let chips = cache.get(index);
		if (!chips) {
			const slice = channels.slice(starts[index], starts[index + 1]);
			chips = packChips(seedFor(index), slice, pageRect(cells[index]), fontUnits, slice.length, reserve)
				.chips;
			cache.set(index, chips);
		}
		return chips;
	}

	const txMax = txMin + plan.cols - 1;
	const tyMax = tyMin + plan.rows - 1;

	return {
		// Dragging right moves the content right, which brings the pages to the
		// LEFT into view — hence the sign flip between page extent and offset.
		min: { x: -txMax * area.width, y: -tyMax * area.height },
		max: { x: -txMin * area.width, y: -tyMin * area.height },

		visibleKey(offset) {
			// The window, in page units: page (0, 0) sits at 0..1 when nothing is dragged.
			const u = -offset.x / area.width;
			const v = -offset.y / area.height;
			const indices: number[] = [];

			for (let ty = Math.floor(v - LOOKAHEAD); ty < v + 1 + LOOKAHEAD; ty++) {
				for (let tx = Math.floor(u - LOOKAHEAD); tx < u + 1 + LOOKAHEAD; tx++) {
					const index = indexAt.get(`${tx},${ty}`);
					if (index !== undefined) indices.push(index);
				}
			}

			return indices.sort((a, b) => a - b).join(',');
		},

		chipsFor(key) {
			if (!key) return [];
			return key.split(',').flatMap((index) => page(Number(index)));
		}
	};
}
