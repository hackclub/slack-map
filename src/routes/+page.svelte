<script lang="ts">
	import { onMount } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';
	import {
		fetchChannels,
		fetchChannelList,
		fetchChannelInfo,
		type SlackChannel,
		type SlackChannelDetails
	} from '../lib/slack.js';
	import { zoneForChannelName } from '../lib/zones.js';
	import ChannelModal from '../lib/ChannelModal.svelte';
	import { loadCustomEmoji } from '../lib/emoji.js';
	import { chipFontUnits, packChips, MAX_CHIPS } from '../lib/islandLayout.js';
	import { createTileField } from '../lib/islandTiles.js';
	import { panzoom, type ViewBox, type Offset } from '../lib/panzoom.js';
	import OnboardingTour from '../lib/tour/OnboardingTour.svelte';
	import { hasSeenTour } from '../lib/tour/storage.js';

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

	/**
	 * How often to ask for the rest of the workspace while the server is still
	 * crawling. The crawl lands a page of channels every few seconds; this only
	 * needs to be frequent enough that the islands visibly fill in.
	 */
	const CHANNEL_POLL_MS = 15000;


	let customEmoji: Record<string, string> = {};

	let isAnimating = false;
	let viewSeq = 0;

	/**
	 * Zone the tour is pointing at, which highlights that region and nothing more.
	 * Kept separate from `selectedChannel` so it never opens the modal.
	 */
	let highlightedZoneKey: string | null = null;

	let modalChannel: SlackChannelDetails | null = null;
	let modalOpen = false;
	let modalLoading = false;
	let modalError = '';

	let tourOpen = false;

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
			path: 'M476 302C477 323 482 344 478 365C475 386 469 414 451 430C433 445 396 448 370 456C344 465 322 476 297 481C271 486 242 487 214 487C186 486 156 483 126 476C98 469 57 461 40 443C23 425 26 392 22 368C19 345 18 324 19 302C19 280 21 261 23 237C24 212 13 172 31 156C49 140 103 142 134 140C166 137 193 142 219 143C246 143 266 142 293 142C318 142 344 139 377 141C407 143 467 138 482 155C498 172 471 217 471 242C469 266 475 282 476 302'
		},
		{
			key: 'ysws',
			label: 'YSWS!',
			fill: '#2d8659',
			stroke: '#5db876',
			// a calm, near-circular mass
			path: 'M834 324C836 340 837 352 842 373C846 394 869 432 860 449C850 467 809 471 784 481C758 491 736 501 709 510C681 519 647 539 619 537C591 534 561 511 539 496C517 480 491 463 485 442C478 422 495 391 498 371C502 352 506 340 504 324C503 308 493 293 491 274C491 256 491 236 499 214C506 193 513 159 535 147C556 135 597 139 625 142C654 145 676 162 703 166C730 169 766 153 787 162C809 171 823 198 829 218C837 237 829 260 829 278C831 296 832 308 834 324'
		},
		{
			key: 'connect',
			label: 'Connect',
			fill: '#556270',
			stroke: '#8b93a1',
			// widest island — a teardrop, fat in the east and tapering west
			path: 'M607 644C606 668 605 690 600 714C594 739 597 776 575 789C552 802 494 793 463 794C432 795 410 795 387 796C362 796 342 796 317 796C293 796 271 796 240 795C208 794 164 800 129 790C94 780 46 760 28 736C10 712 22 675 22 644C22 614 10 577 30 553C48 530 97 510 133 502C169 494 217 505 248 504C279 502 293 498 317 492C342 486 365 472 392 469C419 467 453 467 477 476C503 484 518 506 540 522C561 538 594 552 606 573C616 593 607 621 607 644'
		},
		{
			key: 'software',
			label: 'Software',
			fill: '#a68c2e',
			stroke: '#d4b860',
			// smallest island — a rounded triangle with three broad shoulders
			path: 'M1078 317C1078 326 1077 333 1077 344C1077 354 1078 364 1077 380C1076 396 1081 420 1072 440C1063 460 1043 495 1023 501C1001 506 967 483 945 472C923 462 903 452 890 438C877 425 874 404 869 389C864 375 860 363 858 351C855 339 856 329 855 317C854 305 851 294 851 280C851 267 851 253 855 235C858 216 855 181 870 168C885 156 921 159 944 158C969 158 993 160 1015 166C1036 172 1063 179 1072 194C1082 209 1074 240 1074 256C1076 272 1074 280 1074 290C1076 300 1078 308 1078 317'
		},
		{
			key: 'hardware',
			label: 'Hardware',
			fill: '#7a4d94',
			stroke: '#b88dbf',
			// a crescent, with a bay carved out of the north-west side
			path: 'M1076 652C1077 673 1079 693 1077 716C1074 739 1081 776 1061 789C1041 802 987 793 957 794C927 795 907 795 883 796C860 796 841 796 819 796C796 795 775 795 745 794C716 793 662 802 641 789C620 776 623 740 622 717C620 694 631 673 632 652C634 631 625 609 633 591C641 572 660 553 680 540C699 528 725 522 748 513C770 505 789 497 814 490C838 482 868 466 892 468C917 471 938 493 962 503C987 513 1020 516 1038 530C1057 545 1068 569 1074 589C1081 609 1076 631 1076 652'
		}
	];

	type IslandBounds = { minX: number; minY: number; width: number; height: number };
	const islandBounds: Record<string, IslandBounds> = {
		community: { minX: 19, minY: 139, width: 468, height: 348 },
		ysws: { minX: 484, minY: 139, width: 379, height: 398 },
		connect: { minX: 18, minY: 468, width: 593, height: 328 },
		software: { minX: 851, minY: 158, width: 227, height: 343 },
		hardware: { minX: 622, minY: 468, width: 457, height: 328 }
	};

	import type { PageData } from './$types.js';

	export let data: PageData;

	// Seeded from the server load, so the very first paint already has channels
	// instead of showing "No channels yet" until a client fetch resolves.
	let channels: SlackChannel[] = data.channels;
	/**
	 * A newer channel list that arrived while an island was open. Held back until
	 * it closes: new channels slot in by member count, which reshuffles every page
	 * after the first, and chips jumping under the pointer mid-drag is worse than
	 * waiting.
	 */
	let pendingChannels: SlackChannel[] | null = null;
	let selectedChannel: SlackChannel | null = null;
	let isBooting = false;
	let bootError = data.loadError;
	let zoomedZoneKey: string | null = null;

	/**
	 * How far the opened island's contents have been dragged, in viewBox units.
	 *
	 * Only meaningful while an island is open. Negative values mean the content
	 * has been pulled up or left, bringing the pages below or right of it into
	 * view. The island's own coastline never moves — this is the only thing that
	 * does.
	 */
	let contentOffset: Offset = { x: 0, y: 0 };

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
		community: { x: 31, y: 164, width: 420, height: 263 },
		ysws: { x: 509, y: 192, width: 308, height: 273 },
		connect: { x: 71, y: 535, width: 489, height: 228 },
		software: { x: 883, y: 195, width: 184, height: 235 },
		hardware: { x: 665, y: 555, width: 391, height: 237 }
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
	 * container resizes. In an opened island, chips on other pages land outside
	 * 0-100% and are brought into the box by the content layer's drag transform.
	 */
	function chipOffset(chip: { x: number; y: number }, area: LabelArea) {
		return {
			left: `${((chip.x - area.x) / area.width) * 100}%`,
			top: `${((chip.y - area.y) / area.height) * 100}%`
		};
	}

	/** An island's bounding box as a rect, in world units. */
	function islandRect(zoneKey: string) {
		const bounds = islandBounds[zoneKey];
		return { x: bounds.minX, y: bounds.minY, width: bounds.width, height: bounds.height };
	}

	/** The view that frames one island when it is opened. */
	function islandView(zoneKey: string): ViewBox {
		const bounds = islandBounds[zoneKey];
		return {
			x: bounds.minX - ZOOM_PADDING,
			y: bounds.minY - ZOOM_PADDING,
			width: bounds.width + ZOOM_PADDING * 2,
			height: bounds.height + ZOOM_PADDING * 2
		};
	}

	function setView(next: ViewBox, duration = ZOOM_MS) {
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
	 * The region currently drawn as highlighted: whichever the tour picked, or
	 * failing that the zone the open channel belongs to.
	 */
	$: selectedZoneKey =
		highlightedZoneKey ?? (selectedChannel ? getZoneForChannel(selectedChannel).key : null);
	/**
	 * The full map's chips: the head of each zone, packed into its island's fixed
	 * text area.
	 *
	 * Islands are never resized — the coastlines and their verified 15px
	 * separation stay exactly as authored — and the full map never zooms, so this
	 * always packs at the full-map font. Depends on `channels` alone: nothing about
	 * opening an island or dragging inside it re-packs these.
	 */
	$: zoneEntries = zones.map((zone) => {
		const list = getChannelsForZone(zone.key, channels);
		const area = labelAreas[zone.key];

		const { chips } = packChips(
			zone.key,
			list,
			area,
			CHIP_FONT_UNITS,
			MAX_CHIPS,
			// Keeps chips clear of the zone title pinned to the top of the area. The
			// title renders ~14.2 viewBox units tall; the bottom band keeps the last
			// row off the coastline.
			{ top: CHIP_FONT_UNITS * 1.2, bottom: CHIP_FONT_UNITS * 0.4 }
		);

		return { ...zone, channels: list, area, chips };
	});

	$: zoomedZone = zoneEntries.find((zone) => zone.key === zoomedZoneKey) ?? null;

	/**
	 * The opened island's whole zone, spread evenly over an area larger than its
	 * window that can be dragged in every direction. See islandTiles.ts.
	 *
	 * Chips render at a fixed CSS size, so in the opened view each covers fewer
	 * viewBox units; the font is scaled to that view's width, which is what fits
	 * more channels onto every page.
	 */
	$: tileField = zoomedZone
		? createTileField(
				zoomedZone.key,
				zoomedZone.channels,
				// The island's full bounding box, not its label box: chips are clipped
				// to the coastline now, so the window they fill is the whole island.
				islandRect(zoomedZone.key),
				chipFontUnits(CHIP_FONT_UNITS, islandView(zoomedZone.key).width)
			)
		: null;

	/**
	 * Which pages are near the window. A string, so the statement below re-runs
	 * only when a page edge is crossed — not on every pointermove of a drag.
	 */
	$: visibleTileKey = tileField ? tileField.visibleKey(contentOffset) : '';
	$: zoomedChips = tileField ? tileField.chipsFor(visibleTileKey) : [];

	/**
	 * The chips each island draws. Built here rather than in a template `{@const}`
	 * because that compiles inside `$.untrack(...)`, where a read of `zoomedChips`
	 * would be invisible to Svelte and the pages would never swap in.
	 */
	$: chipsByZone = Object.fromEntries(
		zoneEntries.map((zone) => [zone.key, zone.key === zoomedZoneKey ? zoomedChips : zone.chips])
	);

	/**
	 * The drag transform on the opened island's content layer, as a percentage of
	 * the label box it sits in. Named `contentOffset` directly for the same
	 * tracking reason as above — the layer froze while the pointer moved when this
	 * was read inside the template.
	 */
	$: zoomedContentStyle = zoomedZone
		? `transform:translate(${(contentOffset.x / zoomedZone.area.width) * 100}%,` +
			`${(contentOffset.y / zoomedZone.area.height) * 100}%);`
		: '';

	onMount(() => {
		// Channels already arrived with the server render; only the optional emoji
		// map still needs fetching, and a failure there never blocks the map.
		void loadCustomEmoji().then((map) => {
			customEmoji = map;
		});

		// Client-only on purpose: the tour reads localStorage, and opening it during
		// SSR would flash it at returning visitors before hydration hid it again.
		if (!hasSeenTour()) startTour();

		// A cold server answers with the first ~500 channels and keeps crawling for
		// minutes. Without coming back for the rest, every island but community
		// stayed at a handful of channels — too few to fill even one page, so
		// there was nothing to drag through.
		let pollTimer: number | undefined;
		let stopped = false;

		async function poll() {
			try {
				const { channels: next, crawling } = await fetchChannelList();
				// The crawl only ever adds, so a longer list is a newer one.
				if (next.length > (pendingChannels ?? channels).length) {
					if (zoomedZoneKey) pendingChannels = next;
					else channels = next;
				}
				if (!crawling) return;
			} catch {
				// A failed poll just waits for the next one.
			}
			if (!stopped) pollTimer = window.setTimeout(poll, CHANNEL_POLL_MS);
		}

		if (data.crawling) pollTimer = window.setTimeout(poll, CHANNEL_POLL_MS);

		return () => {
			stopped = true;
			window.clearTimeout(pollTimer);
		};
	});

	/** Applies a list that arrived mid-drag as soon as the island is closed. */
	$: if (!zoomedZoneKey && pendingChannels) {
		channels = pendingChannels;
		pendingChannels = null;
	}

	/**
	 * The tour's spotlight is cut from the islands' own paths in world space, so
	 * it only lines up with the map at the default view. Snap there with no
	 * animation rather than opening the tour over a zoom that is still moving.
	 */
	function startTour() {
		modalOpen = false;
		selectedChannel = null;
		zoomedZoneKey = null;
		contentOffset = { x: 0, y: 0 };
		setView({ x: 0, y: 0, width: 1100, height: 800 }, 0);
		tourOpen = true;
	}

	function endTour() {
		tourOpen = false;
		highlightedZoneKey = null;
	}

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
		// Opening a channel takes over the highlight, or the tour's pick would
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
		// Reset on both open and close, or reopening an island would start
		// part-dragged from wherever it was left.
		contentOffset = { x: 0, y: 0 };

		if (zoomedZoneKey === zoneKey) {
			zoomedZoneKey = null;
			setView({ x: 0, y: 0, width: 1100, height: 800 });
		} else if (islandBounds[zoneKey]) {
			zoomedZoneKey = zoneKey;
			setView(islandView(zoneKey));
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
					<!--
						Each island's own coastline, re-expressed in its label box's
						objectBoundingBox units, so an opened island's chips are clipped to the
						shore itself rather than to the rectangle inside it.
					-->
					{#each zones as zone}
						{@const area = labelAreas[zone.key]}
						<clipPath id={`coast-${zone.key}`} clipPathUnits="objectBoundingBox">
							<path
								d={zone.path}
								transform={`scale(${1 / area.width} ${1 / area.height}) translate(${-area.x} ${-area.y})`}
							/>
						</clipPath>
					{/each}
				</defs>
			</svg>

			<div class="top-wash" aria-hidden="true"></div>

			<header class="map-header">
				<button class="tour-replay" on:click={startTour}>
					<img src="/orpheus-wave.png" alt="" width="427" height="585" />
					Take the tour
				</button>
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
					// Named directly so the action re-runs as the view changes, keeping
					// its pixel-to-unit conversion current through the open animation.
					view: $viewBoxTween,
					// The full map neither zooms nor pans. With an island open the map is
					// frozen and dragging moves through its pages instead. `contentOffset`
					// and `tileField` are named directly for the same reason `view` is —
					// read inside a closure they would be invisible to Svelte and go stale.
					content: tileField
						? {
								offset: contentOffset,
								min: tileField.min,
								max: tileField.max,
								set: (next) => (contentOffset = next)
							}
						: undefined
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
						style={`left:${labelPos.left}; top:${labelPos.top}; width:${labelPos.width}; height:${labelPos.height};` +
							(zoomedZoneKey === zone.key ? `clip-path:url(#coast-${zone.key});` : '')}
					>
						<p class="zone-title">{zone.label}</p>
						{#if zoomedZoneKey === null || zoomedZoneKey === zone.key}
							{#if chipsByZone[zone.key].length}
								<div
									class="zone-content"
									style={zoomedZoneKey === zone.key ? zoomedContentStyle : ''}
								>
								{#each chipsByZone[zone.key] as chip (chip.channel.id)}
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
								</div>
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


			{#if tourOpen}
				<OnboardingTour
					{zones}
					{channels}
					paused={modalOpen}
					on:highlight={(e) => (highlightedZoneKey = e.detail)}
					on:select={(e) => selectChannel(e.detail)}
					on:close={endTour}
				/>
			{/if}

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

	.map-header {
		position: absolute;
		top: 1rem;
		right: 2rem;
		z-index: 3;
		display: flex;
		align-items: center;
		gap: 1.25rem;
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

	/*
		Islands are focusable for keyboard users, but the browser's focus ring is
		drawn around the group's bounding box — with an island open that is a white
		rectangle around the whole screen after every click or drag. Keyboard focus
		lights the coastline instead.
	*/
	.terrain g {
		outline: none;
	}

	.terrain g:focus-visible path {
		stroke: #fff;
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
	.zone-labels.animating .zone-label,
	.zone-labels.animating .zone-content {
		transition: none;
	}

	/*
		The layer that gets dragged when an island is open. It is exactly the label
		box, so chip percentages resolve against the page they were packed into;
		chips on neighbouring pages sit outside 0-100% and the translate brings them
		in — see zoomedContentStyle.
	*/
	.zone-content {
		position: absolute;
		inset: 0;
		transform-origin: 0 0;
		will-change: transform;
	}

	/*
		The window onto that layer is the island itself: the label box is clipped to
		its coastline (the coast-* clip paths), so chips fill the whole island and
		disappear exactly at the shore. It used to be overflow: hidden, which cut
		chips off along the straight edges of the rectangle inscribed in the island —
		mid-island, and plainly visible once the contents could be dragged sideways.
	*/

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
			An opened island only draws the cells under its window (islandTiles.ts),
			so the layer count stays bounded however large the zone is.
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

	/* dark pill on the gold wash: pale text there would be hard to read */
	.tour-replay {
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		border: 0;
		border-radius: 999px;
		padding: 0.45rem 1.1rem 0.45rem 0.55rem;
		background: #1d222c;
		color: #fff;
		font-size: clamp(0.9rem, 1.1vw, 1.05rem);
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 6px 16px rgba(0, 0, 0, 0.18);
		transition:
			transform 0.15s ease,
			background 0.15s ease,
			opacity 0.3s ease;
	}

	/* the gold wash fades out with an island open, and the pill would float on the island */
	.map-stage.zoomed-state .tour-replay {
		opacity: 0;
		pointer-events: none;
	}

	.tour-replay img {
		/* the art faces left; mirrored so Orpheus looks at the label */
		width: auto;
		height: 1.9rem;
		transform: scaleX(-1);
	}

	.tour-replay:hover {
		background: #ec3750;
		transform: translateY(-2px);
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
	}

	@media (max-width: 720px) {
		.map-stage {
			min-height: 820px;
		}

		.top-wash {
			width: 65%;
			height: 14%;
		}

		/* no room beside the title on a phone, so the button drops below it */
		.map-header {
			top: 1.25rem;
			right: 1.25rem;
			flex-direction: column-reverse;
			align-items: flex-end;
			gap: 0.45rem;
		}

		.tour-replay {
			font-size: 0.85rem;
		}

		.map-error {
			left: 1rem;
			right: 1rem;
			bottom: 1rem;
			max-width: none;
			border-radius: 22px;
			flex-direction: column;
			align-items: flex-start;
		}
	}
</style>
