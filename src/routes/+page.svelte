<script lang="ts">
	import { onMount } from 'svelte';
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
			fill: '#475a88',
			stroke: '#56a4eb',
			path: 'M175 78C136 90 104 118 88 152C74 182 76 217 76 250C76 286 74 321 90 353C106 385 135 412 168 425C206 440 249 438 287 428C327 417 367 397 396 367C424 338 442 299 445 260C448 220 442 179 420 148C397 116 361 103 325 94C295 87 272 75 243 72C220 70 196 72 175 78Z',
			labelX: '10',
			labelY: '20',
			labelWidth: '18'
		},
		{
			key: 'ysws',
			label: 'YSWS!',
			fill: '#2b684b',
			stroke: '#63b48a',
			path: 'M552 90C517 97 492 120 481 151C469 185 472 222 456 253C442 282 416 308 415 340C414 372 436 399 463 415C493 432 529 433 564 434C603 435 643 435 677 419C711 403 737 375 751 341C765 307 767 270 768 233C770 199 766 164 746 136C724 106 691 92 657 89C624 86 585 84 552 90Z',
			labelX: '46',
			labelY: '20',
			labelWidth: '16'
		},
		{
			key: 'connect',
			label: 'Connect',
			fill: '#4a5057',
			stroke: '#98a1a9',
			path: 'M150 470C118 479 90 500 71 528C49 560 39 602 45 641C52 681 79 718 110 747C143 777 182 807 225 809C265 811 301 786 337 769C375 751 410 729 450 712C494 693 542 682 577 651C608 624 633 588 631 550C629 514 594 490 558 478C515 464 469 468 425 470C378 472 333 478 286 479C236 480 196 457 150 470Z',
			labelX: '10',
			labelY: '66',
			labelWidth: '22'
		},
		{
			key: 'software',
			label: 'Software',
			fill: '#9d7f1d',
			stroke: '#d7b34d',
			path: 'M777 30C749 49 727 77 729 111C732 149 759 180 792 197C829 216 872 220 912 219C954 218 998 216 1033 192C1066 170 1090 135 1092 95C1094 61 1070 30 1032 30L777 30Z',
			labelX: '74',
			labelY: '5',
			labelWidth: '14'
		},
		{
			key: 'hardware',
			label: 'Hardware',
			fill: '#6f367d',
			stroke: '#ab61bf',
			path: 'M804 386C771 399 745 424 731 455C717 487 716 525 729 556C742 589 769 615 800 629C833 644 871 647 904 633C936 620 962 597 975 566C987 537 988 503 975 473C962 443 936 418 905 405C871 391 838 373 804 386Z',
			labelX: '70',
			labelY: '49',
			labelWidth: '12'
		}
	];

	let channels: SlackChannel[] = [];
	let selectedChannel: SlackChannel | null = null;
	let isBooting = true;
	let bootError = '';

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
</script>

<svelte:head>
	<title>Slack Map</title>
</svelte:head>

<div class="page-shell">
	<section class="map-card" aria-labelledby="map-title">
		<div class="map-stage">
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

			<svg class="terrain" viewBox="0 0 1100 800" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
				{#each zones as zone}
					<path
						d={zone.path}
						fill={zone.fill}
						stroke={zone.stroke}
						stroke-width={selectedZoneKey === zone.key ? '4' : '3'}
						opacity={selectedZoneKey && selectedZoneKey !== zone.key ? '0.78' : '1'}
					/>
				{/each}
			</svg>

			<div class="zone-labels">
				{#each zoneEntries as zone}
					<div
						class:selected={selectedZoneKey === zone.key}
						class="zone-label"
						style={`left:${zone.labelX}%; top:${zone.labelY}%; width:${zone.labelWidth}%;`}
					>
						<p class="zone-title">{zone.label}</p>
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
					</div>
				{/each}
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
	}

	.side-lagoon {
		position: absolute;
		top: 13%;
		right: 0;
		width: 23%;
		height: 87%;
		background: #9cd8e1;
		clip-path: polygon(20% 0, 55% 0, 72% 7%, 100% 6%, 100% 100%, 0 100%, 4% 86%, 0 73%, 8% 57%, 1% 42%, 7% 24%, 1% 10%);
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
	}

	.zone-labels {
		position: absolute;
		inset: 0;
		z-index: 2;
		pointer-events: none;
	}

	.zone-label {
		position: absolute;
		display: grid;
		gap: 0.35rem;
		pointer-events: auto;
	}

	.zone-label.selected .zone-channel,
	.zone-label.selected .zone-title {
		opacity: 1;
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
		padding: 0;
		background: transparent;
		color: #fff;
		font-size: clamp(0.9rem, 1.25vw, 1.24rem);
		font-weight: 800;
		line-height: 1.1;
		text-align: left;
		cursor: pointer;
		opacity: 0.94;
		text-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
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
