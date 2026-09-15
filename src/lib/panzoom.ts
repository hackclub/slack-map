export type ViewBox = { x: number; y: number; width: number; height: number };

/** A translation in viewBox units. */
export type Offset = { x: number; y: number };

export type PanZoomOptions = {
	get: () => ViewBox;
	set: (viewBox: ViewBox) => void;
	/** Zoom limits, expressed as viewBox width. */
	bounds?: { minWidth: number; maxWidth: number };
	/**
	 * The map's own extent. The view is never allowed outside it, so the whole
	 * map is the furthest you can zoom out and panning cannot strand the islands
	 * off in empty space.
	 */
	world?: ViewBox;
	/**
	 * The current view, passed as a plain value rather than read through `get`.
	 * Svelte only tracks what an options literal names directly, so without this
	 * the action's `update` never runs on a zoom and the cursor goes stale — it
	 * stayed unset after clicking into an island, where panning IS possible.
	 */
	view?: ViewBox;
	/**
	 * When set, a drag moves the opened island's contents instead of the map.
	 *
	 * The coastline is drawn from the viewBox, so panning the viewBox would slide
	 * the island itself across the screen. Here the viewBox is left untouched and
	 * only this offset moves, which is what keeps the boundary fixed while more
	 * channels come into view.
	 *
	 * `offset` and `range` are plain values rather than getters for the same
	 * reason `view` is: Svelte only tracks what an options literal names directly,
	 * and a range read inside a closure would go stale — leaving a grab cursor on
	 * an island with nothing left to move.
	 */
	content?: {
		offset: Offset;
		/** Content extent minus the visible window, in viewBox units. */
		range: Offset;
		set: (offset: Offset) => void;
	};
	/** Disables interaction — used while an island is zoom-expanded. */
	disabled?: boolean;
};

/**
 * Svelte action giving the map a hand tool: drag to pan, wheel to zoom.
 *
 * Both act on the SVG viewBox rather than a CSS transform, so panning composes
 * with the existing zoom-to-island tween instead of fighting it.
 */
export function panzoom(node: SVGSVGElement, options: PanZoomOptions) {
	let opts = options;
	/** Pointer is down but has not yet moved far enough to count as a drag. */
	let pending = false;
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let startViewBox: ViewBox | null = null;
	/** Content offset when the drag began, in content mode. */
	let startContent: Offset | null = null;

	/** Movement before a press becomes a pan rather than a click. */
	const DRAG_THRESHOLD_PX = 4;

	const clampRange = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);

	/**
	 * There is only somewhere to pan once the view is smaller than the map. At
	 * full extent the clamp pins the view at the origin, so offering a grab
	 * cursor there would advertise a drag that cannot move anything.
	 */
	function canPan() {
		if (opts.disabled) return false;

		// In content mode the map never moves, so the only question is whether the
		// island holds more than it can show at once.
		if (opts.content) {
			return opts.content.range.x > 0.5 || opts.content.range.y > 0.5;
		}

		const world = opts.world;
		if (!world) return true;

		const viewBox = opts.view ?? opts.get();
		return viewBox.width < world.width - 0.5 || viewBox.height < world.height - 0.5;
	}

	let cursorValue = '';

	function applyCursor() {
		const next = !canPan() ? '' : dragging ? 'grabbing' : 'grab';
		// `update` runs on every frame of the zoom tween, and writing the same
		// value back still dirties style.
		if (next === cursorValue) return;
		cursorValue = next;
		node.style.cursor = next;
	}

	/**
	 * Keep the view inside the map: never wider or taller than the map itself,
	 * and never scrolled past an edge. Without this you can zoom out into empty
	 * space around the islands, or drag them off screen entirely.
	 */
	function clamp(viewBox: ViewBox): ViewBox {
		const world = opts.world;
		if (!world) return viewBox;

		const width = Math.min(viewBox.width, world.width);
		const height = Math.min(viewBox.height, world.height);

		return {
			width,
			height,
			x: Math.min(Math.max(viewBox.x, world.x), world.x + world.width - width),
			y: Math.min(Math.max(viewBox.y, world.y), world.y + world.height - height)
		};
	}

	const commit = (viewBox: ViewBox) => opts.set(clamp(viewBox));

	/**
	 * Pointer deltas arrive in screen pixels; converting through the current
	 * viewBox keeps the map tracking the cursor 1:1 at every zoom level.
	 */
	function unitsPerPixel() {
		const width = node.clientWidth || node.getBoundingClientRect().width || 1;
		return opts.get().width / width;
	}

	/**
	 * Controls that must keep their own press behaviour rather than starting a
	 * drag. Everything else over the map is fair game, chips included.
	 */
	const NO_DRAG = '.legend-panel, .map-header, .zoom-close, .hackclub-flag, .channel-modal';

	function onPointerDown(event: PointerEvent) {
		// Not just cosmetic: starting a drag with nowhere to pan would still mark
		// the gesture as a drag and swallow the click that zooms into an island.
		if (!canPan() || event.button !== 0) return;

		const target = event.target as Element | null;
		if (target?.closest?.(NO_DRAG)) return;

		// Deliberately NOT capturing the pointer here. setPointerCapture retargets
		// later pointer events to this <svg>, which makes the browser dispatch the
		// click to the <svg> instead of the <g> under the cursor — that silently
		// killed click-to-zoom on the islands. Capture only once a real drag starts.
		pending = true;
		dragging = false;
		startX = event.clientX;
		startY = event.clientY;
		startViewBox = opts.get();
		startContent = opts.content ? { ...opts.content.offset } : null;
	}

	function onPointerMove(event: PointerEvent) {
		if (!pending) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (!dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
			// Past the threshold this is a pan, so take the pointer now.
			dragging = true;
			surface.setPointerCapture(event.pointerId);
			applyCursor();
		}

		const scale = unitsPerPixel();

		// Dragging down pulls the content down, revealing what sits above it, so
		// the offset runs from -range (pulled fully up) to 0.
		if (opts.content && startContent) {
			const { range } = opts.content;
			opts.content.set({
				x: clampRange(startContent.x + dx * scale, -range.x, 0),
				y: clampRange(startContent.y + dy * scale, -range.y, 0)
			});
			return;
		}

		if (!startViewBox) return;

		commit({
			...startViewBox,
			x: startViewBox.x - dx * scale,
			y: startViewBox.y - dy * scale
		});
	}

	function onPointerUp(event: PointerEvent) {
		if (!pending) return;

		const wasDragging = dragging;
		pending = false;
		dragging = false;
		startViewBox = null;
		startContent = null;
		if (surface.hasPointerCapture(event.pointerId)) {
			surface.releasePointerCapture(event.pointerId);
		}
		applyCursor();

		// Only a real drag suppresses the click; a plain press must still zoom, and
		// must still open a chip's modal. Capturing on the stage covers chips too,
		// so dragging from one moves the island instead of opening it.
		if (wasDragging) {
			const swallow = (e: Event) => e.stopPropagation();
			surface.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => surface.removeEventListener('click', swallow, { capture: true }), 0);
		}
	}

	function onWheel(event: WheelEvent) {
		if (opts.disabled) return;
		// preventDefault runs first either way, so a wheel over an open island does
		// not scroll the page behind it.
		event.preventDefault();

		// With an island open there is nothing for the wheel to do: zooming would
		// move the coastline, and the contents move by dragging, not scrolling.
		if (opts.content) return;

		const viewBox = opts.get();
		const { minWidth = 200, maxWidth = 4000 } = opts.bounds ?? {};
		// The map's own width is the real outer limit, whatever bounds say.
		const outer = Math.min(maxWidth, opts.world?.width ?? maxWidth);

		const factor = Math.exp(event.deltaY * 0.0012);
		const width = Math.min(outer, Math.max(minWidth, viewBox.width * factor));
		const height = width * (viewBox.height / viewBox.width);

		// Anchor the zoom on the cursor, not the origin, so the point under the
		// pointer stays put.
		const rect = node.getBoundingClientRect();
		const fx = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
		const fy = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;

		commit({
			x: viewBox.x + (viewBox.width - width) * fx,
			y: viewBox.y + (viewBox.height - height) * fy,
			width,
			height
		});

		// Zooming is what changes whether panning is possible at all.
		applyCursor();
	}

	/**
	 * Pointer events are listened for on the stage, not the <svg>.
	 *
	 * The chips live in a sibling layer stacked above the map, so a press that
	 * lands on one never reaches the svg at all. With an island open and well over
	 * a hundred chips on screen, that made most of the island a dead zone where
	 * dragging did nothing. Listening on their common ancestor catches the press
	 * wherever it starts; NO_DRAG keeps the real controls behaving normally, and
	 * the 4px threshold still lets a plain click through to the chip underneath.
	 *
	 * Measurement stays on the svg — `node` — because that is what the viewBox
	 * maps onto.
	 */
	const surface: Element = node.parentElement ?? node;

	node.style.touchAction = 'none';
	applyCursor();

	surface.addEventListener('pointerdown', onPointerDown as EventListener);
	surface.addEventListener('pointermove', onPointerMove as EventListener);
	surface.addEventListener('pointerup', onPointerUp as EventListener);
	surface.addEventListener('pointercancel', onPointerUp as EventListener);
	surface.addEventListener('wheel', onWheel as EventListener, { passive: false });

	return {
		update(next: PanZoomOptions) {
			opts = next;
			applyCursor();
		},
		destroy() {
			surface.removeEventListener('pointerdown', onPointerDown as EventListener);
			surface.removeEventListener('pointermove', onPointerMove as EventListener);
			surface.removeEventListener('pointerup', onPointerUp as EventListener);
			surface.removeEventListener('pointercancel', onPointerUp as EventListener);
			surface.removeEventListener('wheel', onWheel as EventListener);
		}
	};
}
