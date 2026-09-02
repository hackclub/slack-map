<script lang="ts">
	import { onMount } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';
	import {
		fetchChannels,
		fetchChannelInfo,
		type SlackChannel,
		type SlackChannelDetails
	} from '../lib/slack.js';
	import { zoneForChannelName } from '../lib/zones.js';
	import ChannelModal from '../lib/ChannelModal.svelte';
	import { loadCustomEmoji } from '../lib/emoji.js';
	import {
		chipFontUnits,
		packChips,
		MAX_CHIPS,
		MAX_CHIPS_ZOOMED
	} from '../lib/islandLayout.js';
	import { panzoom, type ViewBox } from '../lib/panzoom.js';

	/**
	 * Chip font expressed in viewBox units rather than px. The SVG is stretched to
	 * the container, so packing must reason in the same space the chips are
	 * positioned in — mixing px into it would misjudge widths at other zoom levels.
	 *
	 * This is the packer's *model* of the font, not the size text renders at —
	 * that is .zone-channel's font-size, and the two move independently. Measured
	 * in the browser a chip's font is about 10.5 units on a 1440px-wide map; this
	 * sits above that deliberately, because the ratio shifts with container width
	 * and the packer must over-estimate rather than under-estimate. It had been
	 * 14.5, a 39% over-estimate, which is what left the islands looking empty:
	 * room was being reserved for chips half again bigger than the ones drawn.
	 * Verified from 1000px to 1920px wide; at 11 chips start to overlap.
	 */
	const CHIP_FONT_UNITS = 12;

	/** Margin left around an island when zoomed into it. */
	const ZOOM_PADDING = 15;
	const ZOOM_MS = 700;


	let customEmoji: Record<string, string> = {};

	let packViewWidth = 1100;
	let isAnimating = false;
	let viewSeq = 0;

	/**
	 * Zone picked from the legend, which highlights that region and nothing more.
	 *
	 * Kept separate from `selectedChannel`: the legend used to open the modal for
	 * whichever channel happened to sort first in the zone, which is not something
	 * the reader asked for by clicking a category.
	 */
	let highlightedZoneKey: string | null = null;

	let modalChannel: SlackChannelDetails | null = null;
	let modalOpen = false;
	let modalLoading = false;
	let modalError = '';

	type Zone = {
		key: string;
		label: string;
		fill: string;
		stroke: string;
		path: string;
	};

	const zones: Zone[] = [
		{
			key: 'community',
			label: 'Community',
			fill: '#4a7ba7',
			stroke: '#7aa8d1',
			// largest island — broad, gently lobed coast
			path: 'M373 302C374 323 378 344 375 365C372 386 368 414 354 430C340 445 311 448 291 456C271 465 254 476 234 481C214 486 192 487 170 487C148 486 125 483 102 476C80 469 48 461 35 443C22 425 24 392 21 368C19 345 18 324 19 302C19 280 20 261 22 237C23 212 14 172 28 156C42 140 84 142 108 140C133 137 154 142 174 143C195 143 210 142 231 142C251 142 271 139 296 141C320 143 366 138 378 155C390 172 369 217 369 242C368 266 372 282 373 302'
		},
		{
			key: 'ysws',
			label: 'YSWS!',
			fill: '#2d8659',
			stroke: '#5db876',
			// a calm, near-circular mass
			path: 'M651 324C652 340 653 352 657 373C660 394 678 432 671 449C663 467 631 471 612 481C592 491 575 501 554 510C532 519 506 539 484 537C462 534 439 511 422 496C405 480 385 463 380 442C375 422 388 391 390 371C393 352 396 340 395 324C394 308 386 293 385 274C385 256 385 236 391 214C396 193 402 159 419 147C435 135 467 139 489 142C511 145 528 162 549 166C570 169 598 153 614 162C631 171 642 198 647 218C653 237 647 260 647 278C648 296 649 308 651 324'
		},
		{
			key: 'connect',
			label: 'Connect',
			fill: '#556270',
			stroke: '#8b93a1',
			// widest island — a teardrop, fat in the east and tapering west
			path: 'M475 644C474 668 473 690 469 714C465 739 467 776 450 789C432 802 387 793 363 794C339 795 322 795 304 796C285 796 269 796 250 796C231 796 214 796 190 795C165 794 131 800 104 790C77 780 40 760 26 736C12 712 21 675 21 644C21 614 12 577 27 553C41 530 79 510 107 502C135 494 172 505 196 504C220 502 231 498 250 492C269 486 287 472 308 469C329 467 355 467 374 476C394 484 406 506 423 522C439 538 465 552 474 573C482 593 475 621 475 644'
		},
		{
			key: 'software',
			label: 'Software',
			fill: '#a68c2e',
			stroke: '#d4b860',
			// smallest island — a rounded triangle with three broad shoulders
			path: 'M840 317C840 326 839 333 839 344C839 354 840 364 839 380C838 396 842 420 835 440C828 460 813 495 797 501C780 506 754 483 737 472C720 462 704 452 694 438C684 425 682 404 678 389C674 375 671 363 669 351C667 339 668 329 667 317C666 305 664 294 664 280C664 267 664 253 667 235C669 216 667 181 679 168C690 156 718 159 736 158C755 158 774 160 791 166C807 172 828 179 835 194C843 209 837 240 837 256C838 272 837 280 837 290C838 300 840 308 840 317'
		},
		{
			key: 'hardware',
			label: 'Hardware',
			fill: '#7a4d94',
			stroke: '#b88dbf',
			// a crescent, with a bay carved out of the north-west side
			path: 'M838 652C839 673 841 693 839 716C837 739 842 776 827 789C811 802 769 793 746 794C723 795 707 795 689 796C671 796 656 796 639 796C621 795 605 795 582 794C559 793 517 802 501 789C485 776 487 740 486 717C485 694 493 673 494 652C496 631 489 609 495 591C501 572 516 553 531 540C546 528 566 522 584 513C601 505 616 497 635 490C654 482 677 466 696 468C715 471 731 493 750 503C769 513 795 516 809 530C824 545 832 569 837 589C842 609 838 631 838 652'
		}
	];

	type IslandBounds = { minX: number; minY: number; width: number; height: number };
	const islandBounds: Record<string, IslandBounds> = {
		community: { minX: 19, minY: 139, width: 363, height: 348 },
		ysws: { minX: 379, minY: 139, width: 294, height: 398 },
		connect: { minX: 18, minY: 468, width: 460, height: 328 },
		software: { minX: 664, minY: 158, width: 176, height: 343 },
		hardware: { minX: 486, minY: 468, width: 354, height: 328 }
	};

	import type { PageData } from './$types.js';

	export let data: PageData;

	// Seeded from the server load, so the very first paint already has channels
	// instead of showing "No channels yet" until a client fetch resolves.
	let channels: SlackChannel[] = data.channels;
	let selectedChannel: SlackChannel | null = null;
	let isBooting = false;
	let bootError = data.loadError;
	let zoomedZoneKey: string | null = null;

	const viewBoxTween = tweened(
		{ x: 0, y: 0, width: 1100, height: 800 },
		{
			duration: ZOOM_MS,
			easing: cubicInOut
		}
	);

	$: svgViewBox = `${Math.round($viewBoxTween.x)} ${Math.round($viewBoxTween.y)} ${Math.round($viewBoxTween.width)} ${Math.round($viewBoxTween.height)}`;

	// NOTE: islands interlock, so their bounding boxes deliberately overlap even
	// though no two coastlines come within 15px of each other. Never test island
	// separation with these boxes — compare the outlines themselves.
	// The area inside each island that channel chips may occupy: the largest
	// rectangle that fits within that island's coastline, measured offline from
	// the path itself. Deriving it as a centred inset of the bounding box does not
	// work — `hardware` is a crescent whose bay reaches past its own bbox centre,
	// so its text area sits deliberately off-centre. Re-measure these whenever a
	// path changes, or chips will drift off the coastline.
	type LabelArea = { x: number; y: number; width: number; height: number };
	const labelAreas: Record<string, LabelArea> = {
		community: { x: 28, y: 164, width: 326, height: 263 },
		ysws: { x: 399, y: 192, width: 239, height: 273 },
		connect: { x: 59, y: 535, width: 379, height: 228 },
		software: { x: 689, y: 195, width: 143, height: 235 },
		hardware: { x: 520, y: 555, width: 303, height: 237 }
	};

	/** The map's own coordinate space, which the label layer is laid out in. */
	const WORLD = { width: 1100, height: 800 };

	/**
	 * Each label box in world space, as percentages of the 1100x800 map.
	 *
	 * Constant on purpose: it does not read the tween at all. The layer above
	 * moves instead. Re-projecting these against the live viewBox rewrote
	 * left/top/width/height on five divs every frame, and those are layout
	 * properties — every chip inside is absolutely placed with percentage offsets
	 * and `width: max-content`, so all of them (up to 150 in an open island) were
	 * re-measured, text included, on every frame of the zoom.
	 */
	const labelBoxes = Object.fromEntries(
		Object.entries(labelAreas).map(([key, area]) => [
			key,
			{
				left: `${(area.x / WORLD.width) * 100}%`,
				top: `${(area.y / WORLD.height) * 100}%`,
				width: `${(area.width / WORLD.width) * 100}%`,
				height: `${(area.height / WORLD.height) * 100}%`
			}
		])
	);

	/**
	 * Chips carry absolute viewBox coordinates from the packer, so they are
	 * expressed as a percentage of their own island's area to stay put when the
	 * container resizes.
	 */
	function chipOffset(chip: { x: number; y: number }, area: LabelArea) {
		return {
			left: `${((chip.x - area.x) / area.width) * 100}%`,
			top: `${((chip.y - area.y) / area.height) * 100}%`
		};
	}

	function setView(next: ViewBox, duration = ZOOM_MS) {
		packViewWidth = next.width;

		if (duration) {
			isAnimating = true;
			const seq = ++viewSeq;
			// A tween that gets interrupted aborts without ever resolving its
			// promise, so this is a timer rather than `.then` on the returned one.
			window.setTimeout(() => {
				if (seq === viewSeq) isAnimating = false;
			}, duration);
		} else {
			isAnimating = false;
		}

		return viewBoxTween.set(next, { duration });
	}

	// Chip placement now lives in islandLayout.ts: the old jittered-grid scatter
	// and its grid-searched constants only guaranteed spacing for <= 8 chips per
	// island, which no longer holds now that islands grow with their channel count.

	/**
	 * World -> view as a single compositor-friendly transform on the label layer.
	 *
	 * The store is named directly so the statement actually tracks it — a read
	 * inside a function body is invisible to Svelte, and the labels would sit
	 * frozen in their unzoomed spots while the map animated underneath them.
	 *
	 * translate sits outside the scale, so its percentages resolve against the
	 * layer's own container-sized box and land directly in view space. x and y
	 * scale independently, matching preserveAspectRatio="none" on the SVG.
	 *
	 * --inv-* undoes that scale on each chip so chips keep their authored CSS
	 * size while the layer grows. That is what makes zooming reveal more channels
	 * rather than magnifying the ones already there.
	 */
	$: layerStyle = (() => {
		const vb = $viewBoxTween;
		const sx = WORLD.width / vb.width;
		const sy = WORLD.height / vb.height;
		return (
			`transform:translate(${((-vb.x / vb.width) * 100).toFixed(4)}%,` +
			`${((-vb.y / vb.height) * 100).toFixed(4)}%) ` +
			`scale(${sx.toFixed(4)},${sy.toFixed(4)});` +
			`--inv-x:${(1 / sx).toFixed(5)};--inv-y:${(1 / sy).toFixed(5)};`
		);
	})();

	/**
	 * The region currently drawn as highlighted: whichever the legend picked, or
	 * failing that the zone the open channel belongs to.
	 */
	$: selectedZoneKey =
		highlightedZoneKey ?? (selectedChannel ? getZoneForChannel(selectedChannel).key : null);
	/**
	 * Chips packed into each island's fixed text area.
	 *
	 * Islands are never resized — the coastlines and their verified 15px
	 * separation stay exactly as authored. More channels appear by zooming into
	 * an island: that narrows the viewBox, so each chip covers fewer viewBox
	 * units and far more of them fit in the same area.
	 *
	 * Depends on `channels` and `zoomedZoneKey` only — both discrete. It must not
	 * depend on the viewBox tween, or every frame of the zoom animation (and every
	 * pointermove while panning) would re-pack every chip.
	 */
	/**
	 * Current zoom level, quantised into steps.
	 *
	 * Chip capacity tracks how far in you are: the further you zoom, the fewer
	 * viewBox units each fixed-size chip covers, so more of them fit. Packing off
	 * the raw tween would re-pack every animation frame and every pointermove
	 * while panning; rounding to 50-unit steps means it only recomputes when you
	 * actually cross a level.
	 */
	const ZOOM_QUANTUM = 50;
	$: packWidth =
		Math.max(ZOOM_QUANTUM, Math.round(packViewWidth / ZOOM_QUANTUM) * ZOOM_QUANTUM);

	$: zoneEntries = zones.map((zone) => {
		const list = getChannelsForZone(zone.key, channels);
		const area = labelAreas[zone.key];
		const isZoomed = zoomedZoneKey === zone.key;

		const fontUnits = chipFontUnits(CHIP_FONT_UNITS, packWidth);
		// Zoomed in far enough that the island fills the view, the cap rises with
		// the room available rather than sitting at one fixed number.
		const zoomFactor = 1100 / packWidth;
		const cap = Math.round(Math.min(MAX_CHIPS_ZOOMED, MAX_CHIPS * zoomFactor * zoomFactor));

		// Keep chips clear of the zone title, which is pinned to the top of the
		// area. It is hidden while zoomed, so no band is needed then. The bottom
		// band used to be for the "+N more" badge; with that gone it stays as edge
		// padding, so the last row does not sit flush against the coastline.
		const { chips } = packChips(
			zone.key,
			list,
			area,
			fontUnits,
			cap,
			// Measured in the browser, and re-measured after the heading was
			// enlarged: the title renders ~14.2 viewBox units tall.
			// The title's own height does not scale with the chip font, so the
			// multiplier drops as CHIP_FONT_UNITS rises. The bottom band was sized
			// for the "+N more" badge; with that gone it only needs to keep the last
			// chip off the coastline.
			{ top: isZoomed ? 0 : fontUnits * 1.2, bottom: fontUnits * 0.4 }
		);

		return { ...zone, channels: list, area, chips };
	});

	onMount(() => {
		// Channels already arrived with the server render; only the optional emoji
		// map still needs fetching, and a failure there never blocks the map.
		void loadCustomEmoji().then((map) => {
			customEmoji = map;
		});
	});

	/** Manual retry — forces the server to bypass its cache. */
	async function loadChannels() {
		isBooting = true;
		bootError = '';

		try {
			channels = await fetchChannels({ refresh: true });
		} catch (error) {
			bootError = error instanceof Error ? error.message : 'Unable to load workspace';
		} finally {
			isBooting = false;
		}
	}

	async function selectChannel(channel: SlackChannel) {
		// Opening a channel takes over the highlight, or the legend's pick would
		// keep a different region lit than the one the channel lives in.
		highlightedZoneKey = null;
		selectedChannel = channel;
		modalOpen = true;
		modalLoading = true;
		modalError = '';
		modalChannel = null;

		try {
			modalChannel = await fetchChannelInfo(channel.id);
		} catch (error) {
			modalError = error instanceof Error ? error.message : 'Unable to load channel';
		} finally {
			modalLoading = false;
		}
	}

	function getZoneForChannel(channel: SlackChannel) {
		const key = zoneForChannelName(channel.name);
		return zones.find((zone) => zone.key === key) ?? zones[0];
	}

	// `source` is passed in rather than read off the outer `channels` binding:
	// a `$:` statement only tracks what it names directly, so reading `channels`
	// inside here would leave the dependency invisible and the map would never
	// update once the fetch resolves.
	/**
	 * Channels for one island, ranked busiest-first.
	 *
	 * The cap in packChips keeps only the head of this list, so the ordering
	 * decides which channels a viewer actually sees. Sorting here rather than
	 * relying on the server's ordering keeps that guarantee local and explicit —
	 * a change to the fetch order must not silently change what the map shows.
	 * `id` breaks ties so the order is stable between SSR and the client.
	 */
	function getChannelsForZone(zoneKey: string, source: SlackChannel[] = channels) {
		return source
			.filter((channel) => getZoneForChannel(channel).key === zoneKey)
			.sort(
				(a, b) =>
					(b.num_members ?? 0) - (a.num_members ?? 0) || a.id.localeCompare(b.id)
			);
	}

	function toggleZoom(zoneKey: string) {
		if (zoomedZoneKey === zoneKey) {
			zoomedZoneKey = null;
			setView({ x: 0, y: 0, width: 1100, height: 800 });
		} else {
			zoomedZoneKey = zoneKey;
			const bounds = islandBounds[zoneKey];
			if (bounds) {
				setView({
					x: bounds.minX - ZOOM_PADDING,
					y: bounds.minY - ZOOM_PADDING,
					width: bounds.width + ZOOM_PADDING * 2,
					height: bounds.height + ZOOM_PADDING * 2
				});
			}
		}
	}
</script>

<svelte:head>
	<title>Slack Map</title>
</svelte:head>

<div class="page-shell">
	<section class="map-card" aria-labelledby="map-title">
		<div class="map-stage" class:zoomed-state={zoomedZoneKey !== null}>
			<a
				class="hackclub-flag"
				href="https://hackclub.com/"
				target="_blank"
				rel="noreferrer"
				aria-label="Hack Club"
			>
				<img
					src="https://assets.hackclub.com/flag-orpheus-left.svg"
					alt="Hack Club"
					style="margin-left:-0.6rem"
				/>
			</a>
			<!--
				Coastlines for the two decorative washes. Defined as SVG clip paths in
				objectBoundingBox units (0..1) rather than CSS polygon() so the edges can
				be bezier curves instead of hard vertices, while still scaling with the
				element the way a percentage polygon does.
			-->
			<svg class="clip-defs" aria-hidden="true" focusable="false">
				<defs>
					<clipPath id="wash-coast" clipPathUnits="objectBoundingBox">
						<path
							d="M0.04,0 L1,0 L1,1 C0.84,0.95 0.7,0.86 0.55,0.83 C0.38,0.79 0.24,0.66 0.13,0.55 C0.07,0.49 0.03,0.45 0,0.42 Z"
						/>
					</clipPath>
					<clipPath id="lagoon-coast" clipPathUnits="objectBoundingBox">
						<path
							d="M0.24,0 L1,0 L1,1 L0,1 C0.05,0.87 0.02,0.75 0.05,0.63 C0.08,0.5 0.03,0.38 0.06,0.26 C0.09,0.15 0.15,0.07 0.24,0 Z"
						/>
					</clipPath>
					<!-- narrow screens move the lagoon to the bottom, so it needs a horizontal coast -->
					<clipPath id="lagoon-coast-bottom" clipPathUnits="objectBoundingBox">
						<path
							d="M0,0.2 C0.14,0.06 0.3,0.02 0.45,0.07 C0.62,0.13 0.8,0.03 1,0 L1,1 L0,1 Z"
						/>
					</clipPath>
				</defs>
			</svg>

			<div class="top-wash" aria-hidden="true"></div>
			<div class="side-lagoon" aria-hidden="true"></div>

			<header class="map-header">
				<div>
					<p class="kicker">Workspace atlas</p>
					<h1 id="map-title">Slack Map</h1>
				</div>
			</header>

			<svg
				class="terrain"
				class:zoomed={zoomedZoneKey !== null}
				viewBox={svgViewBox}
				preserveAspectRatio="none"
				aria-hidden="true"
				use:panzoom={{
					get: () => $viewBoxTween,
					set: (vb) => setView(vb, 0),
					// Stays enabled while an island is expanded: dragging moves around
					// inside it and the wheel zooms further in, which is how the channels
					// beyond the visible ones are reached.
					bounds: { minWidth: 90, maxWidth: 1100 },
					// The whole map is as far out as you can go, and panning stops at
					// its edges rather than drifting into empty space.
					world: { x: 0, y: 0, width: 1100, height: 800 },
					// Named directly so the action re-runs on zoom and the grab cursor
					// appears only once there is somewhere to pan.
					view: $viewBoxTween
				}}
			>
				<defs>
					<filter id="island-shadow">
						<feGaussianBlur in="SourceAlpha" stdDeviation="3" />
						<feOffset dx="1" dy="3" />
						<feComponentTransfer>
							<feFuncA type="linear" slope="0.3" />
						</feComponentTransfer>
						<feMerge>
							<feMergeNode />
							<feMergeNode in="SourceGraphic" />
						</feMerge>
					</filter>
				</defs>
				{#each zoneEntries as zone}
					<g
						filter={isAnimating ? undefined : 'url(#island-shadow)'}
						class:zoomable={!zoomedZoneKey}
						on:click={() => toggleZoom(zone.key)}
						role="button"
						tabindex="0"
						on:keydown={(e) => e.key === 'Enter' && toggleZoom(zone.key)}
					>
						<path
							d={zone.path}
							fill={zone.fill}
							stroke={zone.stroke}
							stroke-width={selectedZoneKey === zone.key ? '4' : '3'}
							stroke-linejoin="round"
							opacity={selectedZoneKey && selectedZoneKey !== zone.key ? '0.78' : '1'}
							class:zoomed-island={zoomedZoneKey === zone.key}
							class:hidden-island={zoomedZoneKey && zoomedZoneKey !== zone.key}
						/>
					</g>
				{/each}
			</svg>

			<div
				class="zone-labels"
				class:zoomed={zoomedZoneKey !== null}
				class:animating={isAnimating}
				style={layerStyle}
			>
				{#each zoneEntries as zone}
					{@const labelPos = labelBoxes[zone.key]}
					<div
						class:selected={selectedZoneKey === zone.key}
						class:zoom-expanded={zoomedZoneKey === zone.key}
						class="zone-label"
						style={`left:${labelPos.left}; top:${labelPos.top}; width:${labelPos.width}; height:${labelPos.height};`}
					>
						<p class="zone-title">{zone.label}</p>
						{#if zoomedZoneKey === null || zoomedZoneKey === zone.key}
							{#if zone.chips.length}
								{#each zone.chips as chip (chip.channel.id)}
									{@const spot = chipOffset(chip, zone.area)}
									<button
										class:selected-channel={selectedChannel?.id === chip.channel.id}
										class="zone-channel"
										style={`left:${spot.left}; top:${spot.top}; --tilt:${chip.tilt}deg;`}
										title={chip.channel.num_members
											? `#${chip.channel.name} · ${chip.channel.num_members.toLocaleString()} members`
											: `#${chip.channel.name}`}
										on:click={() => selectChannel(chip.channel)}
									>
										{chip.label}
									</button>
								{/each}
							{:else}
								<p class="zone-placeholder">No channels yet</p>
							{/if}
						{/if}
					</div>
				{/each}
			</div>

			<!--
				Deliberately outside .zone-labels. That container sets z-index: 2, which
				creates a stacking context, so a child's z-index is confined to it — the
				close button ended up beneath the z-index: 3 header and was unclickable.
			-->
			{#if zoomedZoneKey}
				<div class="zone-title-zoom">{zones.find((z) => z.key === zoomedZoneKey)?.label}</div>
				<button
					class="zoom-close"
					on:click={() => toggleZoom(zoomedZoneKey!)}
					aria-label="Zoom out"
				>
					×
				</button>
			{/if}

			<aside class="legend-panel">
				<nav class="legend" aria-label="Channel categories">
					{#each zones as zone}
						<button
							class:active={selectedZoneKey === zone.key}
							class="legend-item"
							aria-pressed={highlightedZoneKey === zone.key}
							on:click={() => {
								// Pressing the lit one again clears it, so the legend is a
								// toggle rather than a one-way trip.
								highlightedZoneKey = highlightedZoneKey === zone.key ? null : zone.key;
							}}
						>
							<span
								class="legend-dot"
								style={`--dot-fill:${zone.fill}; --dot-stroke:${zone.stroke};`}
							></span>
							<span>{zone.label}</span>
						</button>
					{/each}
				</nav>
			</aside>

			{#if bootError}
				<div class="map-error">
					<p>{bootError}</p>
					<button class="refresh-button" on:click={loadChannels} disabled={isBooting}>
						{isBooting ? 'Reloading...' : 'Try again'}
					</button>
				</div>
			{/if}
		</div>
	</section>
</div>

{#if modalOpen}
	<ChannelModal
		channel={modalChannel}
		loading={modalLoading}
		error={modalError}
		emoji={customEmoji}
		on:close={() => (modalOpen = false)}
	/>
{/if}

<style>
	@font-face {
		font-family: 'Phantom Sans';
		src:
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Regular.woff2')
				format('woff2'),
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Regular.woff')
				format('woff');
		font-weight: 400;
		font-style: normal;
		font-display: swap;
	}

	@font-face {
		font-family: 'Phantom Sans';
		src:
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Italic.woff2')
				format('woff2'),
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Italic.woff')
				format('woff');
		font-weight: 400;
		font-style: italic;
		font-display: swap;
	}

	@font-face {
		font-family: 'Phantom Sans';
		src:
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Bold.woff2')
				format('woff2'),
			url('https://assets.hackclub.com/fonts/Phantom_Sans_0.7/Bold.woff')
				format('woff');
		font-weight: 700;
		font-style: normal;
		font-display: swap;
	}

	:global(body) {
		margin: 0;
		min-height: 100vh;
		font-family: 'Phantom Sans', 'Segoe UI', sans-serif;
		background: #f5f2ee;
		color: #fff;
	}

	:global(button, input, textarea, select) {
		font-family: inherit;
	}

	.page-shell {
		min-height: 100vh;
		width: 100%;
	}

	.map-card {
		background: #1d222c;
		overflow: hidden;
		min-height: 100vh;
	}

	.map-stage {
		position: relative;
		min-height: 100vh;
		background: #1d222c;
		overflow: hidden;
	}

	.hackclub-flag {
		position: absolute;
		top: 0;
		left: 10px;
		z-index: 999;
		border: 0;
		width: 256px;
	}

	.hackclub-flag img {
		display: block;
		width: 100%;
		height: auto;
	}

	/* Carries only <defs>, so it must never occupy layout space. */
	.clip-defs {
		position: absolute;
		width: 0;
		height: 0;
		pointer-events: none;
	}

	.top-wash {
		position: absolute;
		top: 0;
		right: 0;
		width: 52%;
		height: 19%;
		background: #d8b864;
		clip-path: url(#wash-coast);
		transition: opacity 0.3s ease;
	}

	.map-stage.zoomed-state .top-wash {
		opacity: 0;
		pointer-events: none;
	}

	.side-lagoon {
		position: absolute;
		top: 13%;
		right: 0;
		width: 23%;
		height: 87%;
		background: #9cd8e1;
		clip-path: url(#lagoon-coast);
		transition: opacity 0.3s ease;
	}

	.map-stage.zoomed-state .side-lagoon {
		opacity: 0;
		pointer-events: none;
	}

	.map-header {
		position: absolute;
		top: 1rem;
		right: 2rem;
		z-index: 3;
		text-align: right;
	}

	.kicker {
		margin: 0;
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.14em;
		color: rgba(255, 255, 255, 0.7);
	}

	h1,
	p {
		margin: 0;
	}

	h1 {
		font-size: clamp(2rem, 3.4vw, 3.25rem);
		line-height: 0.95;
		font-weight: 900;
	}

	.terrain {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		transition: opacity 0.4s ease;
	}

	.terrain g.zoomable {
		cursor: pointer;
	}

	.terrain g.zoomable:hover path {
		filter: brightness(1.15);
		transition: filter 0.2s ease;
	}

	.terrain path {
		transition: opacity 0.5s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.terrain path.hidden-island {
		opacity: 0 !important;
		/*
			opacity:0 still hit-tests in SVG, so without this a faded-out island that
			peeks into the zoomed viewBox would silently steal the click and jump the
			user to a different zone.
		*/
		pointer-events: none;
	}

	.terrain path.zoomed-island {
		opacity: 1 !important;
		/* clicking the enlarged island zooms back out */
		cursor: pointer;
	}

	.zone-labels {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		transition: opacity 0.4s ease;
		/*
			The whole layer moves as one transform, so nothing inside it re-lays-out
			while the map zooms or pans — see layerStyle.
		*/
		transform-origin: 0 0;
		will-change: transform;
	}

	/*
		The chips' --inv-* scale changes on every frame of a zoom, and a transition
		on transform would restart a 200ms interpolation on each of those frames.
		Hover keeps its transition: nothing else is moving then.
	*/
	.zone-labels.animating .zone-channel,
	.zone-labels.animating .zone-label {
		transition: none;
	}

	/*
		Sized to its island's region in world space by labelBoxes. Chips are
		absolutely placed inside it by the packer in islandLayout.ts, so this is
		just their block — a fixed-anchor column used to overflow the coastline
		once a zone held more than a few channels.
	*/
	.zone-label {
		position: absolute;
		/*
			Transparent to the mouse so a click anywhere over the island — including
			the gaps between chips, which is most of the label box — falls through to
			the island path underneath and zooms. Only the chips take clicks back.
		*/
		pointer-events: none;
		opacity: 1;
		transition: opacity 0.3s ease;
		/* Fixed size in world space, so its subtree can never dirty layout
		   outside it. */
		contain: layout style;
	}

	.zone-labels.zoomed .zone-label {
		opacity: 0;
	}

	/* A faded-out label must not leave invisible chips behind to catch clicks. */
	.zone-labels.zoomed .zone-label .zone-channel {
		pointer-events: none;
	}

	.zone-labels.zoomed .zone-label.zoom-expanded {
		opacity: 1;
	}

	.zone-labels.zoomed .zone-label.zoom-expanded .zone-channel {
		pointer-events: auto;
	}

	.zone-label.zoom-expanded {
		z-index: 10;
	}

	/* .zone-title-zoom already names the zone across the top when enlarged. */
	.zone-label.zoom-expanded .zone-title {
		display: none;
	}

	/*
		Chips deliberately keep their normal size when an island is enlarged.
		Growing them would cancel out the extra room the zoom creates, and showing
		more channels is the whole point of zooming in.
	*/

	.zone-label.selected .zone-channel,
	.zone-label.selected .zone-title {
		opacity: 1;
	}

	.zone-title-zoom {
		font-size: 2rem;
		font-weight: 900;
		color: #fff;
		margin: 0;
		position: fixed;
		top: 2rem;
		left: 50%;
		transform: translateX(-50%);
		z-index: 11;
	}

	.zoom-close {
		font-size: 2.5rem;
		color: rgba(255, 255, 255, 0.7);
		line-height: 1;
		transition: all 0.2s ease;
		position: fixed;
		top: 1.5rem;
		right: 2rem;
		z-index: 11;
		cursor: pointer;
		padding: 0.5rem;
		background: rgba(255, 255, 255, 0.1);
		border: none;
		border-radius: 50%;
		width: 3rem;
		height: 3rem;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.zoom-close:hover {
		color: #fff;
		background: rgba(255, 255, 255, 0.15);
		transform: rotate(90deg);
	}

	.zone-title {
		/* pinned to the top of the region; the scatter band starts below it */
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		text-align: center;
		/*
			Phantom Sans only ships 400 and 700, so a heavier font-weight renders
			identically to 700 — the heading reads as bold through full-white fill,
			wider tracking and a dark shadow against the island, not through numbers.
		*/
		color: #fff;
		font-size: clamp(0.72rem, 0.9vw, 0.92rem);
		font-weight: 700;
		letter-spacing: 0.12em;
		text-shadow: 0 1px 6px rgba(0, 0, 0, 0.55);
		text-transform: uppercase;
	}

	.zone-channel,
	.legend-item,
	.refresh-button {
		font: inherit;
	}

	.zone-channel {
		/* left/top come from the packer; the translate centres the chip on
		   that point so a wide name grows evenly either side of it. */
		position: absolute;
		/* re-enabled on top of the label's pointer-events: none */
		pointer-events: auto;
		/* The inverse scale cancels the layer's, keeping the chip at its authored
		   size. It goes before the rotate so the tilt applies to an already
		   un-stretched box. */
		transform: translate(-50%, -50%) scale(var(--inv-x, 1), var(--inv-y, 1))
			rotate(var(--tilt, 0deg));
		/*
			Kept on permanently, which is normally bad practice — but --inv-* changes
			on every frame of a zoom, and without promotion that repaints all ~56
			chips each time. Measured over the open animation: p95 frame 41.6ms
			without it, 13.9ms with. Promoting only while animating was measurably
			worse (27.9ms): the layers get built after the tween has already begun.
			Bounded by MAX_CHIPS_ZOOMED, so this is at most 150 small layers.
		*/
		will-change: transform;
		width: max-content;
		/*
			Was max-width: 100%. That clamp resolves against the label box's *world*
			size, which no longer grows with the zoom, so it would truncate chips
			that visually fit fine. fitLabel in islandLayout.ts is what keeps names
			inside the coastline anyway.
		*/
		max-width: none;
		border: 0;
		padding: 0.28rem 0.6rem;
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		/* Raising this means raising CHIP_FONT_UNITS by the same ratio. */
		font-size: clamp(0.72rem, 0.95vw, 0.95rem);
		font-weight: 800;
		line-height: 1.15;
		white-space: nowrap;
		cursor: pointer;
		opacity: 0.94;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
		border-radius: 8px;
		transition:
			background 0.2s ease,
			transform 0.2s ease;
	}

	.zone-channel:hover {
		background: rgba(255, 255, 255, 0.15);
		/* keep the tilt and the inverse scale, or the chip would snap upright and
		   jump to layer scale on hover */
		transform: translate(-50%, -50%) scale(var(--inv-x, 1), var(--inv-y, 1))
			rotate(var(--tilt, 0deg)) scale(1.09);
		z-index: 2;
	}

	.zone-channel.selected-channel {
		text-decoration: underline;
		text-decoration-thickness: 0.18rem;
		text-underline-offset: 0.2rem;
	}

	.zone-placeholder {
		font-size: 0.72rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.78);
	}

	.legend-panel {
		position: absolute;
		top: 22%;
		right: 1rem;
		z-index: 3;
		/* widened to match the larger type; must stay inside the 23% lagoon band */
		width: min(250px, 21%);
		transition: opacity 0.3s ease;
	}

	.zone-labels.zoomed ~ .legend-panel {
		opacity: 0;
		pointer-events: none;
	}

	.legend {
		display: grid;
		gap: 0.95rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.8rem;
		border: 0;
		padding: 0;
		background: transparent;
		color: #111317;
		font-size: clamp(1.25rem, 1.7vw, 1.55rem);
		font-weight: 800;
		text-align: left;
		cursor: pointer;
	}

	.legend-item.active {
		transform: translateX(4px);
	}

	.legend-dot {
		/* scaled with the label so the swatches don't look undersized beside it */
		width: 1.6rem;
		height: 1.6rem;
		border-radius: 999px;
		background: var(--dot-fill);
		border: 3px solid var(--dot-stroke);
		box-shadow: 0 2px 10px rgba(0, 0, 0, 0.14);
		flex: none;
	}

	.refresh-button {
		border: 0;
		border-radius: 999px;
		padding: 0.7rem 1rem;
		background: #1d222c;
		color: #fff;
		font-weight: 800;
		cursor: pointer;
	}

	.refresh-button:disabled {
		opacity: 0.65;
		cursor: progress;
	}

	.map-error {
		position: absolute;
		left: 1.5rem;
		bottom: 1.5rem;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 0.9rem;
		max-width: min(520px, calc(100% - 3rem));
		padding: 0.85rem 1rem;
		border-radius: 999px;
		background: rgba(27, 34, 44, 0.9);
		border: 1px solid rgba(255, 255, 255, 0.16);
		box-shadow: 0 12px 28px rgba(0, 0, 0, 0.2);
	}

	.map-error p {
		color: rgba(255, 255, 255, 0.92);
		font-size: 0.92rem;
		line-height: 1.35;
	}

	@media (max-width: 980px) {
		.map-stage {
			min-height: 700px;
		}

		.legend-panel {
			top: 18%;
			right: 0.9rem;
			width: min(215px, 22%);
		}

		.legend {
			gap: 0.6rem;
		}
	}

	@media (max-width: 720px) {
		.map-stage {
			min-height: 820px;
		}

		.top-wash {
			width: 65%;
			height: 14%;
		}

		.side-lagoon {
			top: auto;
			bottom: 0;
			width: 100%;
			height: 24%;
			clip-path: url(#lagoon-coast-bottom);
		}

		.map-header {
			top: 1.25rem;
			right: 1.25rem;
		}


		.legend-panel {
			top: auto;
			right: 1rem;
			left: 1rem;
			bottom: 1rem;
			width: auto;
		}

		.legend {
			grid-template-columns: 1fr 1fr;
			gap: 0.8rem 1rem;
		}

		.map-error {
			left: 1rem;
			right: 1rem;
			bottom: 5.8rem;
			max-width: none;
			border-radius: 22px;
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
