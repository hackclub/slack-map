<script lang="ts">
	import { onMount } from 'svelte';
	import { tweened } from 'svelte/motion';
	import { cubicInOut } from 'svelte/easing';
	import { fetchChannels, fetchChannelInfo, type SlackChannel } from '../lib/slack.js';

	type Zone = {
		key: string;
		label: string;
		fill: string;
		stroke: string;
		path: string;
		labelX: string;
		labelY: string;
		labelWidth: string;
	};

	const zones: Zone[] = [
		{
			key: 'community',
			label: 'Community',
			fill: '#4a7ba7',
			stroke: '#7aa8d1',
			path: 'M100 140L115 110L135 120L145 95L165 105L175 85L195 100L210 75L230 110L245 135L255 165L260 200L255 235L235 255L200 260L160 255L125 245L95 225L80 190L85 155Z',
			labelX: '10',
			labelY: '22',
			labelWidth: '18'
		},
		{
			key: 'ysws',
			label: 'YSWS!',
			fill: '#2d8659',
			stroke: '#5db876',
			path: 'M550 100L575 85L600 95L620 75L640 90L655 120L665 155L670 190L665 225L645 250L615 260L575 265L550 255L530 230L520 190L525 150L535 115Z',
			labelX: '50',
			labelY: '22',
			labelWidth: '18'
		},
		{
			key: 'connect',
			label: 'Connect',
			fill: '#556270',
			stroke: '#8b93a1',
			path: 'M130 500L160 485L190 495L215 480L240 495L260 520L275 555L280 595L275 630L255 655L220 670L180 675L145 665L110 645L85 615L70 575L80 535L105 515Z',
			labelX: '13',
			labelY: '66',
			labelWidth: '20'
		},
		{
			key: 'software',
			label: 'Software',
			fill: '#a68c2e',
			stroke: '#d4b860',
			path: 'M760 70L790 55L820 65L850 48L875 70L895 100L910 140L915 180L905 210L875 230L840 235L805 225L780 205L765 170L760 130Z',
			labelX: '72',
			labelY: '15',
			labelWidth: '16'
		},
		{
			key: 'hardware',
			label: 'Hardware',
			fill: '#7a4d94',
			stroke: '#b88dbf',
			path: 'M830 425L855 410L880 425L900 455L905 490L895 520L870 535L840 540L815 520L810 480L820 450Z',
			labelX: '70',
			labelY: '55',
			labelWidth: '16'
		}
	];

	type IslandBounds = { minX: number; minY: number; width: number; height: number };
	const islandBounds: Record<string, IslandBounds> = {
		community: { minX: 80, minY: 75, width: 180, height: 190 },
		ysws: { minX: 520, minY: 85, width: 150, height: 180 },
		connect: { minX: 70, minY: 480, width: 220, height: 205 },
		software: { minX: 760, minY: 48, width: 155, height: 162 },
		hardware: { minX: 810, minY: 405, width: 100, height: 140 }
	};

	let channels: SlackChannel[] = [];
	let selectedChannel: SlackChannel | null = null;
	let isBooting = true;
	let bootError = '';
	let zoomedZoneKey: string | null = null;
	let svgElement: SVGSVGElement;

	const viewBoxTween = tweened(
		{ x: 0, y: 0, width: 1100, height: 800 },
		{
			duration: 700,
			easing: cubicInOut
		}
	);

	$: svgViewBox = `${Math.round($viewBoxTween.x)} ${Math.round($viewBoxTween.y)} ${Math.round($viewBoxTween.width)} ${Math.round($viewBoxTween.height)}`;

	function getLabelPosition(zone: Zone) {
		if (!zoomedZoneKey) {
			return { left: `${zone.labelX}%`, top: `${zone.labelY}%`, width: `${zone.labelWidth}%` };
		}

		const vb = $viewBoxTween;
		const labelXNum = parseFloat(zone.labelX);
		const labelYNum = parseFloat(zone.labelY);
		const labelWidthNum = parseFloat(zone.labelWidth);

		// labelX/Y are percentages of the full map (1100x800 viewBox)
		const svgX = (labelXNum / 100) * 1100;
		const svgY = (labelYNum / 100) * 800;
		const svgWidth = (labelWidthNum / 100) * 1100;

		// Transform to zoomed viewBox space as percentages
		const percentX = ((svgX - vb.x) / vb.width) * 100;
		const percentY = ((svgY - vb.y) / vb.height) * 100;
		const percentWidth = (svgWidth / vb.width) * 100;

		return { left: `${percentX}%`, top: `${percentY}%`, width: `${percentWidth}%` };
	}

	$: selectedZoneKey = selectedChannel ? getZoneForChannel(selectedChannel).key : null;
	$: zoneEntries = zones.map((zone) => ({
		...zone,
		channels: getChannelsForZone(zone.key)
	}));

	onMount(async () => {
		await loadChannels();
	});

	async function loadChannels() {
		isBooting = true;
		bootError = '';

		try {
			channels = await fetchChannels();
			selectedChannel = channels[0] ?? null;
		} catch (error) {
			bootError = error instanceof Error ? error.message : 'Unable to load workspace';
			selectedChannel = null;
		} finally {
			isBooting = false;
		}
	}

	async function selectChannel(channel: SlackChannel) {
		selectedChannel = channel;
		bootError = '';

		try {
			await fetchChannelInfo(channel.id);
		} catch (error) {
			bootError = error instanceof Error ? error.message : 'Unable to inspect channel';
		}
	}

	function hashChannel(name: string) {
		let hash = 0;

		for (const character of name) {
			hash = (hash * 31 + character.charCodeAt(0)) % 2147483647;
		}

		return hash;
	}

	function getZoneForChannel(channel: SlackChannel) {
		return zones[hashChannel(channel.name) % zones.length];
	}

	function getChannelsForZone(zoneKey: string) {
		return channels.filter((channel) => getZoneForChannel(channel).key === zoneKey).slice(0, 8);
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
				/>
			</a>
			<div class="top-wash" aria-hidden="true"></div>
			<div class="side-lagoon" aria-hidden="true"></div>

			<header class="map-header">
				<div>
					<p class="kicker">Workspace atlas</p>
					<h1 id="map-title">Slack Map</h1>
				</div>
			</header>

			<svg
				bind:this={svgElement}
				class="terrain"
				class:zoomed={zoomedZoneKey !== null}
				viewBox={svgViewBox}
				preserveAspectRatio="xMidYMid meet"
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
					{@const labelPos = getLabelPosition(zone)}
					<div
						class:selected={selectedZoneKey === zone.key}
						class:zoom-expanded={zoomedZoneKey === zone.key}
						class="zone-label"
						style={`left:${labelPos.left}; top:${labelPos.top}; width:${labelPos.width};`}
					>
						<p class="zone-title">{zone.label}</p>
						{#if zoomedZoneKey === null || zoomedZoneKey === zone.key}
							{#if zone.channels.length}
								{#each zone.channels as channel}
									<button
										class:selected-channel={selectedChannel?.id === channel.id}
										class="zone-channel"
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

	.top-wash {
		position: absolute;
		top: 0;
		right: 0;
		width: 52%;
		height: 19%;
		background: #d8b864;
		clip-path: polygon(4% 0, 100% 0, 100% 100%, 82% 92%, 72% 81%, 56% 84%, 44% 76%, 33% 80%, 22% 68%, 11% 62%, 0 42%);
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
		clip-path: polygon(20% 0, 55% 0, 72% 7%, 100% 6%, 100% 100%, 0 100%, 4% 86%, 0 73%, 8% 57%, 1% 42%, 7% 24%, 1% 10%);
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
	}

	.terrain path.zoomed-island {
		opacity: 1 !important;
	}

	.zone-labels {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
		transition: opacity 0.4s ease;
	}

	.zone-label {
		position: absolute;
		display: grid;
		gap: 0.35rem;
		pointer-events: auto;
		opacity: 1;
		transition: opacity 0.3s ease;
	}

	.zone-labels.zoomed .zone-label {
		opacity: 0;
		pointer-events: none;
	}

	.zone-labels.zoomed .zone-label.zoom-expanded {
		opacity: 1;
		pointer-events: auto;
	}

	.zone-label.zoom-expanded {
		z-index: 10;
		pointer-events: auto;
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
		margin-bottom: 0.15rem;
		color: rgba(255, 255, 255, 0.78);
		font-size: clamp(0.72rem, 0.95vw, 0.92rem);
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
		display: block;
		width: fit-content;
		border: 0;
		padding: 0.5rem 1rem;
		background: rgba(255, 255, 255, 0.08);
		color: #fff;
		font-size: clamp(0.9rem, 1.25vw, 1.24rem);
		font-weight: 800;
		line-height: 1.1;
		text-align: left;
		cursor: pointer;
		opacity: 0.94;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
		border-radius: 8px;
		transition: all 0.2s ease;
	}

	.zone-channel:hover {
		background: rgba(255, 255, 255, 0.15);
		transform: translateX(4px);
	}

	.zone-channel.selected-channel {
		text-decoration: underline;
		text-decoration-thickness: 0.18rem;
		text-underline-offset: 0.2rem;
	}

	.zone-placeholder {
		font-size: 0.92rem;
		font-weight: 700;
		color: rgba(255, 255, 255, 0.78);
	}

	.legend-panel {
		position: absolute;
		top: 22%;
		right: 1rem;
		z-index: 3;
		width: min(180px, 18%);
		transition: opacity 0.3s ease;
	}

	.zone-labels.zoomed ~ .legend-panel {
		opacity: 0;
		pointer-events: none;
	}

	.legend {
		display: grid;
		gap: 0.7rem;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.7rem;
		border: 0;
		padding: 0;
		background: transparent;
		color: #111317;
		font-size: clamp(1rem, 1.35vw, 1.22rem);
		font-weight: 800;
		text-align: left;
		cursor: pointer;
	}

	.legend-item.active {
		transform: translateX(4px);
	}

	.legend-dot {
		width: 1.25rem;
		height: 1.25rem;
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
			width: min(170px, 20%);
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
			clip-path: polygon(0 20%, 17% 0, 37% 8%, 52% 0, 71% 10%, 100% 0, 100% 100%, 0 100%);
		}

		.map-header {
			top: 1.25rem;
			right: 1.25rem;
		}

		.zone-label {
			width: 38% !important;
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
