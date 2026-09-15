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
 * The area is the island's window scaled up by the same factor in both
 * directions and centred on where the island opens, so there is always as much
 * room to drag sideways as up and down. It is sized to the zone and split into
 * equal cells that each get the same share of channels, so the density is even
 * everywhere. The busiest channels go to the cells nearest the middle, where you
 * land.
 *
 * Only cells overlapping the window are ever packed, and each is packed once, so
 * a zone of thousands of channels costs no more to drag through than one of fifty.
 */

export type TileField = {
	/** Offsets the content may be dragged to: the edges of the area. */
	min: Offset;
	max: Offset;
	/**
	 * Which cells overlap the window at `offset`, as a string key.
	 *
	 * A primitive on purpose: it only changes when a cell boundary is crossed, so
	 * a reactive statement keyed on it re-runs a handful of times per drag rather
	 * than on every pointermove.
	 */
	visibleKey: (offset: Offset) => string;
	/** The chips for a key from `visibleKey`, packing any cell not yet seen. */
	chipsFor: (key: string) => PlacedChip[];
};

/**
 * Share of a window's capacity the area is filled to.
 *
 * Filling to capacity front-loads the channels and leaves the last cells with
 * whatever is left over. Sizing the area for a little under capacity gives every
 * cell the same share, with room to absorb cells whose long names fit fewer chips.
 */
const FILL = 0.75;

/**
 * The smallest the area gets, as a multiple of the window on each side.
 *
 * A zone that fits in its window would otherwise get an area exactly that size,
 * with nowhere to drag at all — and after a full crawl that is most zones. At 2
 * there is half a window of travel each way on both axes, which reads as moving
 * around; 1.5 gave a quarter, which felt stuck.
 */
const MIN_SPAN = 2;

/**
 * Fewest channels a window should show when MIN_SPAN spreads a zone out.
 *
 * Spreading nine channels over four windows' worth of area leaves an opened
 * island almost empty, with the odd chip at its edges. A zone too small to
 * spread that far without dropping below this gets only as much room as keeps
 * the window this full.
 */
const MIN_PER_WINDOW = 12;

/** How much the area grows each time the channels don't all fit. */
const GROW = 1.08;

type Cell = Rect & { col: number; row: number };

export function createTileField(
	zoneKey: string,
	channels: SlackChannel[],
	area: Rect,
	fontUnits: number
): TileField {
	// Half-font margins inside every cell, so chips on either side of a cell edge
	// still end up at least a full gap apart.
	const margin = fontUnits * 0.5;
	const reserve: Reserve = { top: margin, bottom: margin };
	const inset = (rect: Rect): Rect => ({
		x: rect.x + margin,
		y: rect.y,
		width: rect.width - margin * 2,
		height: rect.height
	});

	// Each cell gets its own seed, or every cell would share one scatter pattern
	// and the area would visibly repeat. Planning and packing must use the same
	// key: tilt comes from it, and tilt changes how many chips fit.
	const seedFor = (index: number) => `${zoneKey}:cell:${index}`;
	const total = channels.length;

	/**
	 * Lays out an area `span` windows wide and `span` windows tall, and hands every
	 * cell an equal share of the channels, middle cells first. Returns null if they
	 * don't all fit, which only happens when many cells hold less than their share.
	 */
	function layout(span: number) {
		// Cells a third to a half of the window across. Every cell the window touches
		// is drawn whole, so window-sized cells drew up to nine windows' worth of
		// chips at once — 1,500 of them in a large zone. Much smaller and they would
		// cut long names short, since a chip can't be wider than its cell.
		// The count is odd so one cell sits in the middle, under the window as the
		// island opens, holding the busiest channels; with an even count the cells
		// met at the centre and the middle of the island opened empty.
		const count = 2 * Math.floor(span + 1e-6) + 1;
		const width = span * area.width;
		const height = span * area.height;
		const x0 = area.x - (width - area.width) / 2;
		const y0 = area.y - (height - area.height) / 2;
		const cellWidth = width / count;
		const cellHeight = height / count;

		const cells: Cell[] = [];
		for (let row = 0; row < count; row++) {
			for (let col = 0; col < count; col++) {
				cells.push({
					col,
					row,
					x: x0 + col * cellWidth,
					y: y0 + row * cellHeight,
					width: cellWidth,
					height: cellHeight
				});
			}
		}

		// Nearest the middle first, measured in windows so a wide window doesn't
		// favour the cells above and below it over those beside it.
		const distance = (cell: Cell) =>
			((cell.x + cell.width / 2 - (x0 + width / 2)) / area.width) ** 2 +
			((cell.y + cell.height / 2 - (y0 + height / 2)) / area.height) ** 2;
		cells.sort((a, b) => distance(a) - distance(b) || a.row - b.row || a.col - b.col);

		// starts[i] is the first channel in cell i; the last entry is where they ran out.
		// Each cell fills up to a running target rather than taking a fixed share,
		// so a zone with fewer channels than cells leaves its empty cells evenly
		// spread through the area instead of all out at the edge, and a cell that
		// fits less than its share (fitRows keeps whole rows) passes the rest on.
		const starts = [0];
		for (let i = 0; i < cells.length; i++) {
			const start = starts[i];
			const want = Math.round(((i + 1) * total) / cells.length) - start;
			const fits =
				want > 0
					? countFitting(
							seedFor(i),
							channels.slice(start, start + want),
							inset(cells[i]),
							fontUnits,
							reserve
						)
					: 0;
			starts.push(start + fits);
		}

		if (starts[cells.length] < total) return null;
		return { cells, starts, count, width, height, x0, y0, cellWidth, cellHeight };
	}

	// What one window holds, measured against a window's worth of the zone's own
	// names — cycled if the zone is small, or a seven-channel zone would look like
	// a window only holds seven.
	const sample = total
		? Array.from({ length: MAX_CHIPS_ZOOMED }, (_, i) => channels[i % total])
		: [];
	const capacity = Math.max(1, countFitting(seedFor(0), sample, inset(area), fontUnits, reserve));

	// The zone needs total / (capacity * FILL) windows of area. The square root of
	// that on both sides keeps the area the window's own shape, only bigger —
	// which is what gives sideways travel as well as vertical. Sizing it square on
	// screen instead turned every mid-sized zone into a single column of pages on
	// a wide monitor, and those could only be moved up and down.
	const needed = Math.sqrt(total / (capacity * FILL));
	const roomy = Math.min(MIN_SPAN, Math.sqrt(total / MIN_PER_WINDOW));
	let span = Math.max(1, needed, roomy);
	let plan = layout(span);
	// Every cell always fits at least one row, so growing eventually fits them all.
	while (!plan) {
		span *= GROW;
		plan = layout(span);
	}

	const { cells, starts, count, width, height, x0, y0, cellWidth, cellHeight } = plan;
	const indexAt = new Map(cells.map((cell, i) => [cell.row * count + cell.col, i]));
	const cache = new Map<number, PlacedChip[]>();

	function cellChips(index: number) {
		let chips = cache.get(index);
		if (!chips) {
			const slice = channels.slice(starts[index], starts[index + 1]);
			chips = packChips(seedFor(index), slice, inset(cells[index]), fontUnits, slice.length, reserve)
				.chips;
			cache.set(index, chips);
		}
		return chips;
	}

	// How far the window can travel from the centre before it reaches an edge.
	const travelX = (width - area.width) / 2;
	const travelY = (height - area.height) / 2;

	return {
		// Dragging right moves the content right, bringing what lies left of the
		// window into view.
		min: { x: -travelX, y: -travelY },
		max: { x: travelX, y: travelY },

		visibleKey(offset) {
			// The window, in content coordinates.
			const left = area.x - offset.x;
			const top = area.y - offset.y;

			// Every chip sits inside its own cell's margins, so only cells actually
			// overlapping the window can show anything. Pulling in neighbours as well
			// would draw up to nine cells in the frame the open animation starts.
			const colFrom = Math.max(0, Math.floor((left - x0) / cellWidth));
			const colTo = Math.min(count - 1, Math.ceil((left + area.width - x0) / cellWidth) - 1);
			const rowFrom = Math.max(0, Math.floor((top - y0) / cellHeight));
			const rowTo = Math.min(count - 1, Math.ceil((top + area.height - y0) / cellHeight) - 1);

			const indices: number[] = [];
			for (let row = rowFrom; row <= rowTo; row++) {
				for (let col = colFrom; col <= colTo; col++) {
					const index = indexAt.get(row * count + col);
					if (index !== undefined) indices.push(index);
				}
			}

			return indices.sort((a, b) => a - b).join(',');
		},

		chipsFor(key) {
			if (!key) return [];
			return key.split(',').flatMap((index) => cellChips(Number(index)));
		}
	};
}
