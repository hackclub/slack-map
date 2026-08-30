export type ViewBox = { x: number; y: number; width: number; height: number };

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

	/** Movement before a press becomes a pan rather than a click. */
	const DRAG_THRESHOLD_PX = 4;

	/**
	 * There is only somewhere to pan once the view is smaller than the map. At
	 * full extent the clamp pins the view at the origin, so offering a grab
	 * cursor there would advertise a drag that cannot move anything.
	 */
	function canPan() {
		if (opts.disabled) return false;

		const world = opts.world;
		if (!world) return true;

		const viewBox = opts.view ?? opts.get();
		return viewBox.width < world.width - 0.5 || viewBox.height < world.height - 0.5;
	}

	function applyCursor() {
		node.style.cursor = !canPan() ? '' : dragging ? 'grabbing' : 'grab';
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

	function onPointerDown(event: PointerEvent) {
		// Not just cosmetic: starting a drag with nowhere to pan would still mark
		// the gesture as a drag and swallow the click that zooms into an island.
		if (!canPan() || event.button !== 0) return;

		// Deliberately NOT capturing the pointer here. setPointerCapture retargets
		// later pointer events to this <svg>, which makes the browser dispatch the
		// click to the <svg> instead of the <g> under the cursor — that silently
		// killed click-to-zoom on the islands. Capture only once a real drag starts.
		pending = true;
		dragging = false;
		startX = event.clientX;
		startY = event.clientY;
		startViewBox = opts.get();
	}

	function onPointerMove(event: PointerEvent) {
		if (!pending || !startViewBox) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;

		if (!dragging) {
			if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
			// Past the threshold this is a pan, so take the pointer now.
			dragging = true;
			node.setPointerCapture(event.pointerId);
			applyCursor();
		}

		const scale = unitsPerPixel();
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
		if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
		applyCursor();

		// Only a real drag suppresses the click; a plain press must still zoom.
		if (wasDragging) {
			const swallow = (e: Event) => e.stopPropagation();
			node.addEventListener('click', swallow, { capture: true, once: true });
			setTimeout(() => node.removeEventListener('click', swallow, { capture: true }), 0);
		}
	}

	function onWheel(event: WheelEvent) {
		if (opts.disabled) return;
		event.preventDefault();

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

	node.style.touchAction = 'none';
	applyCursor();

	node.addEventListener('pointerdown', onPointerDown);
	node.addEventListener('pointermove', onPointerMove);
	node.addEventListener('pointerup', onPointerUp);
	node.addEventListener('pointercancel', onPointerUp);
	node.addEventListener('wheel', onWheel, { passive: false });

	return {
		update(next: PanZoomOptions) {
			opts = next;
			applyCursor();
		},
		destroy() {
			node.removeEventListener('pointerdown', onPointerDown);
			node.removeEventListener('pointermove', onPointerMove);
			node.removeEventListener('pointerup', onPointerUp);
			node.removeEventListener('pointercancel', onPointerUp);
			node.removeEventListener('wheel', onWheel);
		}
	};
}
