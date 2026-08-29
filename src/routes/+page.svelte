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

	let customEmoji: Record<string, string> = {};


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
			duration: 700,
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

	// `viewBox` is a parameter rather than a `$viewBoxTween` read inside the body:
	// Svelte compiles a template `{@const}` inside `$.untrack(...)`, so a store
	// read in here would be invisible and the labels would stay frozen in their
	// unzoomed spots while the map animated underneath them.
	function getLabelPosition(zone: Zone, viewBox: { x: number; y: number; width: number; height: number }) {
		const area = labelAreas[zone.key];
		const vb = viewBox;

		// One path for both states: unzoomed the viewBox is just the full map.
		return {
			left: `${((area.x - vb.x) / vb.width) * 100}%`,
			top: `${((area.y - vb.y) / vb.height) * 100}%`,
			width: `${(area.width / vb.width) * 100}%`,
			height: `${(area.height / vb.height) * 100}%`
		};
	}

	// --- scattered channel placement -------------------------------------------
	// Chips sit at pseudo-random spots inside their island rather than on a grid.
	// Every position is derived from the channel name, never Math.random(): the
	// server and client must agree during hydration, and a chip must not hop to a
	// new spot every time the component re-renders.

	function hashString(value: string) {
		let hash = 2166136261;

		for (let index = 0; index < value.length; index++) {
			hash ^= value.charCodeAt(index);
			hash = Math.imul(hash, 16777619);
		}

		return hash >>> 0;
	}

	/** mulberry32 — one stable float in [0,1) per seed. */
	function seededRandom(seed: number) {
		let t = (seed + 0x6d2b79f5) | 0;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}

	function greatestCommonDivisor(a: number, b: number): number {
		return b === 0 ? a : greatestCommonDivisor(b, a % b);
	}

	// Horizontal/vertical share of the label box the scatter may use, the top band
	// kept clear for the zone title, and how far a chip may drift inside its cell.
	// These were grid-searched for zero chip-on-chip overlap and zero overflow
	// across 1280..1920 wide viewports, against the labelAreas above. Re-run that
	// search if a labelArea shrinks: `community` packs 8 chips into the tightest
	// area and is the first to collide.
	const SCATTER_SPREAD_X = 46;
	const SCATTER_TOP = 22;
	const SCATTER_BOTTOM = 97;
	const SCATTER_JITTER_X = 0.4;
	const SCATTER_JITTER_Y = 0.5;
	// Chips are far wider than they are tall, so more than two per row collides.
	const SCATTER_SINGLE_COLUMN_MAX = 3;

	function getScatterPosition(zoneKey: string, name: string, index: number, total: number) {
		const seed = hashString(`${zoneKey}:${name}`);

		// Stratified sampling: hand each chip its own cell of a coarse grid, then
		// jitter inside that cell. Pure random would clump and overlap; this keeps
		// them apart while still reading as scattered.
		const columns = total <= SCATTER_SINGLE_COLUMN_MAX ? 1 : 2;
		const rows = Math.max(1, Math.ceil(total / columns));
		const cellCount = columns * rows;

		// Walking the cells with a stride coprime to the count visits each exactly
		// once, so chips fill the island in a shuffled order instead of row by row.
		let stride = 1 + (hashString(zoneKey) % Math.max(1, cellCount - 1));
		while (greatestCommonDivisor(stride, cellCount) !== 1) stride++;
		const cell = (index * stride) % cellCount;

		const column = cell % columns;
		const row = Math.floor(cell / columns);

		const jitterX = (seededRandom(seed) - 0.5) * SCATTER_JITTER_X;
		const jitterY = (seededRandom(seed ^ 0x9e3779b9) - 0.5) * SCATTER_JITTER_Y;

		// -1..1 within the box, then pulled inside an inscribed ellipse so chips
		// follow the blob's rounded silhouette instead of reaching into its corners.
		let unitX = ((column + 0.5 + jitterX) / columns) * 2 - 1;
		let unitY = ((row + 0.5 + jitterY) / rows) * 2 - 1;

		const radius = Math.hypot(unitX, unitY);
		if (radius > 0.95) {
			unitX = (unitX / radius) * 0.95;
			unitY = (unitY / radius) * 0.95;
		}

		return {
			left: `${50 + unitX * SCATTER_SPREAD_X}%`,
			top: `${SCATTER_TOP + (unitY * 0.5 + 0.5) * (SCATTER_BOTTOM - SCATTER_TOP)}%`,
			tilt: ((seededRandom(seed ^ 0x85ebca6b) - 0.5) * 9).toFixed(2)
		};
	}

	// Named here so the reactive statement actually tracks the tween; the template
	// only reads the finished map, which keeps the labels glued to their islands
	// through the whole zoom animation.
	$: labelBoxes = Object.fromEntries(
		zones.map((zone) => [zone.key, getLabelPosition(zone, $viewBoxTween)])
	);

	$: selectedZoneKey = selectedChannel ? getZoneForChannel(selectedChannel).key : null;
	$: zoneEntries = zones.map((zone) => ({
		...zone,
		channels: getChannelsForZone(zone.key, channels)
	}));

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
	function getChannelsForZone(zoneKey: string, source: SlackChannel[] = channels) {
		return source.filter((channel) => getZoneForChannel(channel).key === zoneKey).slice(0, 8);
	}

	function toggleZoom(zoneKey: string) {
		if (zoomedZoneKey === zoneKey) {
			zoomedZoneKey = null;
			viewBoxTween.set({ x: 0, y: 0, width: 1100, height: 800 });
		} else {
			zoomedZoneKey = zoneKey;
			const bounds = islandBounds[zoneKey];
			if (bounds) {
				const padding = 15;
				viewBoxTween.set({
					x: bounds.minX - padding,
					y: bounds.minY - padding,
					width: bounds.width + padding * 2,
					height: bounds.height + padding * 2
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
				{#each zones as zone}
					<g
						filter="url(#island-shadow)"
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

			<div class="zone-labels" class:zoomed={zoomedZoneKey !== null}>
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
							{#if zone.channels.length}
								{#each zone.channels as channel, index}
									{@const spot = getScatterPosition(
										zone.key,
										channel.name,
										index,
										zone.channels.length
									)}
									<button
										class:selected-channel={selectedChannel?.id === channel.id}
										class="zone-channel"
										style={`left:${spot.left}; top:${spot.top}; --tilt:${spot.tilt}deg;`}
										on:click={() => selectChannel(channel)}
									>
										#{channel.name}
									</button>
								{/each}
							{:else}
								<p class="zone-placeholder">No channels yet</p>
							{/if}
						{/if}
					</div>
				{/each}
				{#if zoomedZoneKey}
					<div class="zone-title-zoom">{zones.find(z => z.key === zoomedZoneKey)?.label}</div>
					<button
						class="zoom-close"
						on:click={() => toggleZoom(zoomedZoneKey!)}
						aria-label="Zoom out"
					>
						×
					</button>
				{/if}
			</div>

			<aside class="legend-panel">
				<nav class="legend" aria-label="Channel categories">
					{#each zones as zone}
						<button
							class:active={selectedZoneKey === zone.key}
							class="legend-item"
							on:click={() => {
								const channel = getChannelsForZone(zone.key)[0];
								if (channel) void selectChannel(channel);
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
	}

	/*
		Sized to its island's region by getLabelPosition. Chips are absolutely
		placed inside it by getScatterPosition, so this is just their containing
		block — a fixed-anchor column used to overflow the coastline once a zone
		held more than a few channels.
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

	/* The island fills the viewport when enlarged, so the chips grow with it. */
	.zone-label.zoom-expanded .zone-channel {
		font-size: clamp(1rem, 1.5vw, 1.5rem);
		padding: 0.5rem 1rem;
		border-radius: 12px;
	}

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
		color: rgba(255, 255, 255, 0.78);
		font-size: clamp(0.58rem, 0.7vw, 0.72rem);
		font-weight: 800;
		letter-spacing: 0.05em;
		text-transform: uppercase;
	}

	.zone-channel,
	.legend-item,
	.refresh-button {
		font: inherit;
	}

	.zone-channel {
		/* left/top come from getScatterPosition; the translate centres the chip on
		   that point so a wide name grows evenly either side of it. */
		position: absolute;
		/* re-enabled on top of the label's pointer-events: none */
		pointer-events: auto;
		transform: translate(-50%, -50%) rotate(var(--tilt, 0deg));
		width: max-content;
		max-width: 100%;
		border: 0;
		padding: 0.28rem 0.6rem;
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		font-size: clamp(0.66rem, 0.85vw, 0.86rem);
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
		/* keep the tilt, or the chip would snap upright on hover */
		transform: translate(-50%, -50%) rotate(var(--tilt, 0deg)) scale(1.09);
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
