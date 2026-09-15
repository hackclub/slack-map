export type ViewBox = { x: number; y: number; width: number; height: number };

/** A translation in viewBox units. */
export type Offset = { x: number; y: number };

export type PanZoomOptions = {
	/**
	 * The current view, used to convert screen pixels into viewBox units.
	 *
	 * Passed as a plain value rather than a getter: Svelte only tracks what an
	 * options literal names directly, so a getter would never re-run `update`.
	 */
	view: ViewBox;
	/**
	 * The opened island's contents. Absent on the full map, which neither zooms
	 * nor pans — the only way in is clicking an island.
	 *
	 * The coastline is drawn from the viewBox, so moving the viewBox would slide
	 * the island itself across the screen. Only this offset moves instead, which
	 * keeps the boundary fixed while more channels come into view.
	 *
	 * `offset`, `min` and `max` are plain values for the same reason `view` is.
	 */
	content?: {
		offset: Offset;
		/** How far the content may be dragged, per axis. */
		min: Offset;
		max: Offset;
		set: (offset: Offset) => void;
	};
	disabled?: boolean;
};

/**
 * Svelte action giving an opened island a hand tool: drag, or scroll with a
 * wheel or trackpad, to move through its contents in any direction.
 */
export function panzoom(node: SVGSVGElement, options: PanZoomOptions) {
	let opts = options;
	/** Pointer is down but has not yet moved far enough to count as a drag. */
	let pending = false;
	let dragging = false;
	let startX = 0;
	let startY = 0;
	/** Content offset when the drag began. */
	let startContent: Offset | null = null;

	/** Movement before a press becomes a drag rather than a click. */
	const DRAG_THRESHOLD_PX = 4;

	/** Pixels per wheel "line", for mice that report deltaMode 1. */
	const LINE_PX = 16;

	const clampRange = (value: number, min: number, max: number) =>
		Math.min(Math.max(value, min), max);

	function canPan() {
		const content = opts.content;
		if (opts.disabled || !content) return false;
		// Zero on a zone whose channels all fit on one page, which keeps the grab
		// cursor off islands with nothing to drag.
		return content.max.x - content.min.x > 0.5 || content.max.y - content.min.y > 0.5;
	}

	let cursorValue = '';

	function applyCursor() {
		const next = !canPan() ? '' : dragging ? 'grabbing' : 'grab';
		// `update` runs on every frame of the zoom tween, and writing the same
		// value back still dirties style.
		if (next === cursorValue) return;
		cursorValue = next;
		node.style.cursor = next;
		// Touch dragging is only claimed while there is something to drag, so on
		// the full map a finger can still scroll a phone-height page.
		node.style.touchAction = next ? 'none' : '';
	}

	/**
	 * Screen pixels -> viewBox units, per axis. The SVG uses
	 * preserveAspectRatio="none", so the two axes scale independently.
	 */
	function unitsPerPixel() {
		const rect = node.getBoundingClientRect();
		return {
			x: opts.view.width / (rect.width || 1),
			y: opts.view.height / (rect.height || 1)
		};
	}

	function moveContent(from: Offset, dxPx: number, dyPx: number) {
		const content = opts.content;
		if (!content) return;
		const scale = unitsPerPixel();
		content.set({
			x: clampRange(from.x + dxPx * scale.x, content.min.x, content.max.x),
			y: clampRange(from.y + dyPx * scale.y, content.min.y, content.max.y)
		});
	}

	/**
	 * Controls that must keep their own press behaviour rather than starting a
	 * drag. Everything else over the map is fair game, chips included.
	 */
	const NO_DRAG = '.map-header, .zoom-close, .hackclub-flag, .channel-modal';

	function onPointerDown(event: PointerEvent) {
		// Tracked even when the island has nowhere to go. A zone small enough to
		// fit its window can't move, but a press-and-move over it is still a drag
		// attempt — letting it end as a click closed the island out from under the
		// user. On the full map there is no content, so a press stays a click and
		// opens the island.
		if (opts.disabled || event.button !== 0 || !opts.content) return;

		const target = event.target as Element | null;
		if (target?.closest?.(NO_DRAG)) return;

		// Deliberately NOT capturing the pointer here. setPointerCapture retargets
		// later pointer events to the stage, which makes the browser dispatch the
		// click there instead of to the chip under the cursor. Capture only once a
		// real drag starts.
		pending = true;
		dragging = false;
		startX = event.clientX;
		startY = event.clientY;
		startContent = { ...opts.content.offset };
	}

	function onPointerMove(event: PointerEvent) {
		if (!pending || !startContent) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (!dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
			// Past the threshold this is a drag, so take the pointer now.
			dragging = true;
			surface.setPointerCapture(event.pointerId);
			applyCursor();
		}

		// Dragging right pulls the content right, bringing what lies to its left
		// into view.
		moveContent(startContent, dx, dy);
	}

	function onPointerUp(event: PointerEvent) {
		if (!pending) return;

		const wasDragging = dragging;
		pending = false;
		dragging = false;
		startContent = null;
		if (surface.hasPointerCapture(event.pointerId)) {
			surface.releasePointerCapture(event.pointerId);
		}
		applyCursor();

		// Only a real drag suppresses the click; a plain press must still open a
		// chip's modal. Capturing on the stage covers chips too, so dragging from
		// one moves the contents instead of opening it.
		if (wasDragging) {
			const swallow = (e: Event) => e.stopPropagation();
			surface.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => surface.removeEventListener('click', swallow, { capture: true }), 0);
		}
	}

	function onWheel(event: WheelEvent) {
		// The full map ignores the wheel entirely — it does not zoom — and leaves
		// it to the page, so a phone-height layout can still scroll.
		if (!canPan() || !opts.content) return;
		event.preventDefault();

		const unit =
			event.deltaMode === 1 ? LINE_PX : event.deltaMode === 2 ? node.clientHeight : 1;
		let dx = event.deltaX * unit;
		let dy = event.deltaY * unit;
		// A plain mouse wheel only has one axis; shift turns it sideways.
		if (event.shiftKey && !dx) {
			dx = dy;
			dy = 0;
		}

		// Scrolling moves the view, the opposite of dragging the content.
		moveContent(opts.content.offset, -dx, -dy);
	}

	/**
	 * Pointer events are listened for on the stage, not the <svg>.
	 *
	 * The chips live in a sibling layer stacked above the map, so a press that
	 * lands on one never reaches the svg at all, and most of an opened island
	 * would be a dead zone. Listening on their common ancestor catches the press
	 * wherever it starts; NO_DRAG keeps the real controls behaving normally, and
	 * the 4px threshold still lets a plain click through to the chip underneath.
	 *
	 * Measurement stays on the svg — `node` — because that is what the viewBox
	 * maps onto.
	 */
	const surface: Element = node.parentElement ?? node;

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
