export type ViewBox = { x: number; y: number; width: number; height: number };

export type PanZoomOptions = {
	get: () => ViewBox;
	set: (viewBox: ViewBox) => void;
	/** Zoom limits, expressed as viewBox width. */
	bounds?: { minWidth: number; maxWidth: number };
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
	let dragging = false;
	let moved = false;
	let startX = 0;
	let startY = 0;
	let startViewBox: ViewBox | null = null;

	function applyCursor() {
		node.style.cursor = opts.disabled ? '' : dragging ? 'grabbing' : 'grab';
	}

	/**
	 * Pointer deltas arrive in screen pixels; converting through the current
	 * viewBox keeps the map tracking the cursor 1:1 at every zoom level.
	 */
	function unitsPerPixel() {
		const width = node.clientWidth || node.getBoundingClientRect().width || 1;
		return opts.get().width / width;
	}

	function onPointerDown(event: PointerEvent) {
		if (opts.disabled || event.button !== 0) return;

		dragging = true;
		moved = false;
		startX = event.clientX;
		startY = event.clientY;
		startViewBox = opts.get();
		node.setPointerCapture(event.pointerId);
		applyCursor();
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || !startViewBox) return;

		const dx = event.clientX - startX;
		const dy = event.clientY - startY;
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved = true;

		const scale = unitsPerPixel();
		opts.set({
			...startViewBox,
			x: startViewBox.x - dx * scale,
			y: startViewBox.y - dy * scale
		});
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging) return;

		dragging = false;
		startViewBox = null;
		if (node.hasPointerCapture(event.pointerId)) node.releasePointerCapture(event.pointerId);
		applyCursor();

		// A drag must not also register as a click on the island underneath.
		if (moved) {
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

		const factor = Math.exp(event.deltaY * 0.0012);
		const width = Math.min(maxWidth, Math.max(minWidth, viewBox.width * factor));
		const height = width * (viewBox.height / viewBox.width);

		// Anchor the zoom on the cursor, not the origin, so the point under the
		// pointer stays put.
		const rect = node.getBoundingClientRect();
		const fx = rect.width ? (event.clientX - rect.left) / rect.width : 0.5;
		const fy = rect.height ? (event.clientY - rect.top) / rect.height : 0.5;

		opts.set({
			x: viewBox.x + (viewBox.width - width) * fx,
			y: viewBox.y + (viewBox.height - height) * fy,
			width,
			height
		});
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
