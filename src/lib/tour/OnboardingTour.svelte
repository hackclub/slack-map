<script lang="ts">
	import { createEventDispatcher, onDestroy, onMount } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import type { SlackChannel } from '../slack.js';
	import Mascot from './Mascot.svelte';
	import { TOUR_STEPS, type TourTarget } from './steps.js';
	import { HOBBIES, suggestChannels, type Suggestion } from './hobbies.js';
	import { loadHobbies, markTourSeen, saveHobbies } from './storage.js';

	type ZoneShape = { key: string; label: string; path: string };

	export let zones: ZoneShape[];
	export let channels: SlackChannel[];
	/** The legend panel, so the tour can frame it. */
	export let legendEl: HTMLElement | null = null;
	/** True while the channel modal sits on top; keyboard shortcuts belong to it then. */
	export let paused = false;

	const dispatch = createEventDispatcher<{
		highlight: string | null;
		select: SlackChannel;
		close: void;
	}>();

	/**
	 * The overlay shares the terrain's 1100x800 viewBox, so an island's own path
	 * can be used as the spotlight hole. That only lines up while the map is fully
	 * zoomed out, which is why the page resets the view before opening the tour.
	 */
	const WORLD = { width: 1100, height: 800 };
	const TYPE_MS = 22;

	// Only ever mounted from onMount on the page, so window is always there.
	const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	let index = 0;
	let overlayEl: SVGSVGElement | null = null;
	let primaryBtn: HTMLButtonElement | null = null;

	const saved = loadHobbies();
	let pickedHobbies: string[] = saved.keys;
	let customHobby = saved.custom;
	let suggestions: Suggestion[] = [];

	$: step = TOUR_STEPS[index];
	$: isFirst = index === 0;
	$: isLast = index === TOUR_STEPS.length - 1;
	$: text =
		step.kind === 'suggestions' && !suggestions.length ? (step.emptyText ?? step.text) : step.text;
	$: canContinue =
		step.kind !== 'hobbies' || pickedHobbies.length > 0 || customHobby.trim().length > 0;

	// --- typewriter -----------------------------------------------------------

	let shown = 0;
	let typeTimer: number | undefined;

	function typeOut(full: string) {
		window.clearInterval(typeTimer);
		shown = reduceMotion ? full.length : 0;
		if (shown >= full.length) return;
		typeTimer = window.setInterval(() => {
			shown += 1;
			if (shown >= full.length) window.clearInterval(typeTimer);
		}, TYPE_MS);
	}

	$: typeOut(text);
	$: typing = shown < text.length;

	function skipTyping() {
		window.clearInterval(typeTimer);
		shown = text.length;
	}

	onDestroy(() => window.clearInterval(typeTimer));
	onMount(() => primaryBtn?.focus({ preventScroll: true }));

	// --- spotlight ------------------------------------------------------------

	$: zoneKey = step.target?.type === 'zone' ? step.target.key : null;
	$: zonePath = zones.find((zone) => zone.key === zoneKey)?.path ?? null;
	$: dispatch('highlight', zoneKey);

	let focusRect: { x: number; y: number; width: number; height: number } | null = null;

	/**
	 * The legend is HTML, not part of the map, so its on-screen box is converted
	 * into viewBox units. The arguments are passed in rather than read from the
	 * outer scope so the `$:` call below tracks them.
	 */
	function measure(target: TourTarget, el: HTMLElement | null, overlay: SVGSVGElement | null) {
		if (target?.type !== 'legend' || !el || !overlay) {
			focusRect = null;
			return;
		}
		const stage = overlay.getBoundingClientRect();
		const box = el.getBoundingClientRect();
		const pad = 14;
		focusRect = {
			x: ((box.left - stage.left - pad) / stage.width) * WORLD.width,
			y: ((box.top - stage.top - pad) / stage.height) * WORLD.height,
			width: ((box.width + pad * 2) / stage.width) * WORLD.width,
			height: ((box.height + pad * 2) / stage.height) * WORLD.height
		};
	}

	$: measure(step.target, legendEl, overlayEl);

	// --- navigation -----------------------------------------------------------

	function next() {
		if (!canContinue) return;
		if (step.kind === 'hobbies') {
			saveHobbies(pickedHobbies, customHobby);
			suggestions = suggestChannels(channels, pickedHobbies, customHobby);
		}
		if (isLast) return finish();
		index += 1;
	}

	function back() {
		if (index > 0) index -= 1;
	}

	function finish() {
		markTourSeen();
		dispatch('highlight', null);
		dispatch('close');
	}

	function toggleHobby(key: string) {
		pickedHobbies = pickedHobbies.includes(key)
			? pickedHobbies.filter((k) => k !== key)
			: [...pickedHobbies, key];
	}

	function onKey(event: KeyboardEvent) {
		if (paused) return;
		if (event.key === 'Escape') return finish();

		// Arrow keys move the cursor inside the text box, so there only Enter advances.
		if (event.target instanceof HTMLInputElement) {
			if (event.key === 'Enter') next();
			return;
		}
		// A focused button already handles Enter itself; advancing here too would skip a step.
		if (event.target instanceof HTMLButtonElement) {
			if (event.key === 'ArrowLeft') back();
			if (event.key === 'ArrowRight') next();
			return;
		}
		if (event.key === 'ArrowRight' || event.key === 'Enter') next();
		if (event.key === 'ArrowLeft') back();
	}
</script>

<svelte:window on:keydown={onKey} on:resize={() => measure(step.target, legendEl, overlayEl)} />

<!--
	Covers the whole map, holes included: SVG masks don't affect hit-testing, so
	the map can't be panned or zoomed out from under the spotlight mid-tour.
-->
<svg
	class="tour-dim"
	bind:this={overlayEl}
	viewBox="0 0 1100 800"
	preserveAspectRatio="none"
	aria-hidden="true"
	transition:fade={{ duration: 250 }}
>
	<defs>
		<mask id="tour-spotlight" maskUnits="userSpaceOnUse" x="0" y="0" width="1100" height="800">
			<rect width="1100" height="800" fill="#fff" />
			{#if zonePath}
				<!-- the black stroke widens the hole a little past the coastline -->
				<path d={zonePath} fill="#000" stroke="#000" stroke-width="18" stroke-linejoin="round" />
			{:else if focusRect}
				<rect {...focusRect} rx="14" fill="#000" />
			{/if}
		</mask>
	</defs>

	<rect width="1100" height="800" class="dim" mask="url(#tour-spotlight)" />

	{#key zoneKey ?? step.target?.type}
		{#if zonePath}
			<path class="glow" d={zonePath} stroke-width="18" in:fade={{ duration: 300 }} />
		{:else if focusRect}
			<rect class="glow" {...focusRect} rx="14" stroke-width="6" in:fade={{ duration: 300 }} />
		{/if}
	{/key}
</svg>

<div class="tour-dock" class:right={step.side === 'right'} transition:fly={{ y: 40, duration: 350 }}>
	<div class="tour-mascot">
		<Mascot mood={step.mood ?? 'idle'} talking={typing} />
	</div>

	<div class="tour-bubble" role="dialog" aria-modal="false" aria-labelledby="tour-speaker">
		<div class="tour-head">
			<p class="tour-speaker" id="tour-speaker">Orpheus</p>
			{#if !isFirst && !isLast}
				<button type="button" class="tour-close" on:click={finish} aria-label="End tour">×</button>
			{/if}
		</div>

		<!-- screen readers get the whole line at once instead of one letter at a time -->
		<p class="sr-only" aria-live="polite">{text}</p>

		<!-- svelte-ignore a11y_click_events_have_key_events -->
		<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
		<p class="tour-text" aria-hidden="true" on:click={skipTyping}>
			<!-- the invisible full line reserves the bubble's final size, so it doesn't grow while typing -->
			<span class="ghost">{text}</span>
			<span>{text.slice(0, shown)}</span>
		</p>

		{#if step.kind === 'hobbies'}
			<div class="hobby-grid" role="group" aria-label="Hobbies">
				{#each HOBBIES as hobby (hobby.key)}
					<button
						type="button"
						class="hobby-chip"
						aria-pressed={pickedHobbies.includes(hobby.key)}
						on:click={() => toggleHobby(hobby.key)}
					>
						<span aria-hidden="true">{hobby.emoji}</span>
						{hobby.label}
					</button>
				{/each}
			</div>
			<label class="hobby-other">
				<span>Something else?</span>
				<input
					type="text"
					bind:value={customHobby}
					placeholder="chess, knitting, rockets…"
					maxlength="80"
				/>
			</label>
		{:else if step.kind === 'suggestions' && suggestions.length}
			<ul class="suggestion-list">
				{#each suggestions as suggestion (suggestion.channel.id)}
					<li>
						<button
							type="button"
							class="suggestion"
							on:click={() => dispatch('select', suggestion.channel)}
						>
							<span class="suggestion-name">#{suggestion.channel.name}</span>
							<span class="suggestion-meta">
								{suggestion.hobby.emoji}
								{suggestion.hobby.label}
								{#if suggestion.channel.num_members}
									· {suggestion.channel.num_members.toLocaleString()} members
								{/if}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}

		<div class="tour-footer">
			<div class="tour-progress" aria-label={`Step ${index + 1} of ${TOUR_STEPS.length}`}>
				{#each TOUR_STEPS as s, i (s.id)}
					<span class="dot" class:current={i === index} class:done={i < index}></span>
				{/each}
			</div>
			<div class="tour-actions">
				{#if isFirst}
					<button type="button" class="tour-btn ghost" on:click={finish}>Skip tour</button>
				{:else}
					<button type="button" class="tour-btn ghost" on:click={back}>Back</button>
				{/if}
				<button
					type="button"
					class="tour-btn primary"
					bind:this={primaryBtn}
					on:click={next}
					disabled={!canContinue}
				>
					{step.cta ?? 'Next'}
				</button>
			</div>
		</div>
	</div>
</div>

<style>
	/* Sits in .map-stage exactly over .terrain: above the labels (2) and header (3), below the modal (50). */
	.tour-dim {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		z-index: 20;
	}

	.dim {
		fill: rgba(8, 10, 16, 0.72);
	}

	.glow {
		fill: none;
		stroke: #fff;
		stroke-linejoin: round;
		animation: pulse 1.6s ease-in-out infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			stroke-opacity: 0.12;
		}
		50% {
			stroke-opacity: 0.45;
		}
	}

	/* Fixed, not absolute: the stage can be taller than the viewport on small screens. */
	.tour-dock {
		position: fixed;
		bottom: 1.5rem;
		left: 1.5rem;
		z-index: 30;
		display: flex;
		align-items: flex-end;
		gap: 0.5rem;
		max-width: min(620px, calc(100vw - 3rem));
	}

	.tour-dock.right {
		left: auto;
		right: 1.5rem;
		flex-direction: row-reverse;
	}

	.tour-mascot {
		flex: none;
		width: 130px;
		/* The art faces left, so on the left-hand dock it is mirrored to face the bubble. */
		transform: scaleX(-1);
	}

	.right .tour-mascot {
		transform: none;
	}

	.tour-bubble {
		position: relative;
		flex: 1;
		min-width: 0;
		max-height: calc(100vh - 3rem);
		overflow-y: auto;
		margin-bottom: 3.5rem;
		padding: 1rem 1.15rem 0.9rem;
		border-radius: 20px;
		background: #fff;
		color: #1d222c;
		box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
	}

	.tour-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.tour-speaker {
		margin: 0;
		font-size: 0.75rem;
		font-weight: 700;
		letter-spacing: 0.12em;
		text-transform: uppercase;
		color: #ec3750;
	}

	.tour-close {
		border: 0;
		background: transparent;
		font-size: 1.4rem;
		line-height: 1;
		color: #8492a6;
		cursor: pointer;
	}

	.tour-text {
		display: grid;
		margin: 0.35rem 0 0.8rem;
		font-size: 1.05rem;
		line-height: 1.45;
		cursor: default;
	}

	.tour-text > span {
		grid-area: 1 / 1;
	}

	.tour-text .ghost {
		visibility: hidden;
	}

	.hobby-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
		gap: 0.45rem;
	}

	.hobby-chip {
		border: 2px solid #e0e6ed;
		border-radius: 999px;
		padding: 0.4rem 0.7rem;
		background: #f9fafc;
		color: #1d222c;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 700;
		text-align: left;
		cursor: pointer;
		transition:
			background 0.15s ease,
			border-color 0.15s ease,
			transform 0.15s ease;
	}

	.hobby-chip:hover {
		transform: translateY(-1px);
	}

	.hobby-chip[aria-pressed='true'] {
		background: #ec3750;
		border-color: #ec3750;
		color: #fff;
	}

	.hobby-other {
		display: grid;
		gap: 0.25rem;
		margin-top: 0.7rem;
		font-size: 0.85rem;
		font-weight: 700;
		color: #5c6878;
	}

	.hobby-other input {
		border: 2px solid #e0e6ed;
		border-radius: 10px;
		padding: 0.5rem 0.65rem;
		font: inherit;
		font-size: 0.95rem;
		color: #1d222c;
	}

	.hobby-other input:focus {
		outline: none;
		border-color: #338eda;
	}

	.suggestion-list {
		display: grid;
		gap: 0.4rem;
		margin: 0;
		padding: 0;
		list-style: none;
	}

	.suggestion {
		display: flex;
		width: 100%;
		flex-wrap: wrap;
		align-items: baseline;
		justify-content: space-between;
		gap: 0.2rem 0.75rem;
		border: 0;
		border-radius: 12px;
		padding: 0.55rem 0.75rem;
		background: #f1f4f8;
		color: #1d222c;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}

	.suggestion:hover {
		background: #e3e9f1;
	}

	.suggestion-name {
		font-weight: 700;
	}

	.suggestion-meta {
		font-size: 0.8rem;
		color: #5c6878;
	}

	.tour-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.9rem;
	}

	.tour-progress {
		display: flex;
		gap: 4px;
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: #d6dde6;
		transition:
			width 0.2s ease,
			background 0.2s ease;
	}

	.dot.done {
		background: #f59aa8;
	}

	.dot.current {
		width: 16px;
		background: #ec3750;
	}

	.tour-actions {
		display: flex;
		gap: 0.45rem;
	}

	.tour-btn {
		border: 0;
		border-radius: 999px;
		padding: 0.5rem 1rem;
		font: inherit;
		font-weight: 700;
		cursor: pointer;
	}

	.tour-btn.ghost {
		background: transparent;
		color: #5c6878;
	}

	.tour-btn.primary {
		background: #ec3750;
		color: #fff;
	}

	.tour-btn.primary:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip: rect(0 0 0 0);
		white-space: nowrap;
	}

	@media (max-width: 720px) {
		.tour-dock,
		.tour-dock.right {
			left: 1rem;
			right: 1rem;
			bottom: 1rem;
			max-width: none;
			flex-direction: row;
		}

		.tour-mascot,
		.right .tour-mascot {
			width: 72px;
			transform: scaleX(-1);
		}

		.tour-bubble {
			margin-bottom: 1.5rem;
		}

		.hobby-grid {
			grid-template-columns: 1fr 1fr;
		}
	}
</style>
