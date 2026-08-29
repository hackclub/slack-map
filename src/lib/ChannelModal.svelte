<script lang="ts">
	import { createEventDispatcher } from 'svelte';
	import { channelUrl, formatSlackText, type SlackChannelDetails } from './slack.js';

	export let channel: SlackChannelDetails | null = null;
	export let loading = false;
	export let error = '';

	const dispatch = createEventDispatcher<{ close: void }>();
	const close = () => dispatch('close');

	// Named directly rather than read inside a helper, so the template tracks them.
	$: memberCount =
		typeof channel?.num_members === 'number'
			? new Intl.NumberFormat().format(channel.num_members)
			: null;
	$: created = channel?.created
		? new Date(channel.created * 1000).toLocaleDateString(undefined, {
				year: 'numeric',
				month: 'long',
				day: 'numeric'
			})
		: null;
	$: purpose = formatSlackText(channel?.purpose?.value);
	$: topic = formatSlackText(channel?.topic?.value);

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') close();
	}

	/** Move focus into the dialog on open so Escape and tabbing work immediately. */
	function autofocus(node: HTMLElement) {
		node.focus();
	}
</script>

<svelte:window on:keydown={onKeydown} />

<!-- svelte-ignore a11y-click-events-have-key-events a11y-no-static-element-interactions -->
<div class="scrim" on:click={close}>
	<!-- tabindex so the dialog itself can hold focus when it opens -->
	<div
		class="card"
		role="dialog"
		aria-modal="true"
		tabindex="-1"
		aria-label={channel ? `#${channel.name}` : 'Channel details'}
		on:click|stopPropagation
		use:autofocus
	>
		<button class="close" on:click={close} aria-label="Close">×</button>

		{#if loading}
			<p class="muted">Loading channel…</p>
		{:else if error}
			<p class="error">{error}</p>
		{:else if channel}
			<header>
				<h2>#{channel.name}</h2>
				<div class="badges">
					{#if channel.is_private}<span class="badge">Private</span>{/if}
					{#if channel.is_archived}<span class="badge">Archived</span>{/if}
				</div>
			</header>

			{#if purpose}<p class="purpose">{purpose}</p>{/if}
			{#if topic && topic !== purpose}<p class="topic">{topic}</p>{/if}

			<dl class="stats">
				{#if memberCount}
					<div><dt>Members</dt><dd>{memberCount}</dd></div>
				{/if}
				{#if created}
					<div><dt>Created</dt><dd>{created}</dd></div>
				{/if}
			</dl>

			<a class="open" href={channelUrl(channel.id)} target="_blank" rel="noreferrer">
				Open in Slack →
			</a>
		{/if}
	</div>
</div>

<style>
	.scrim {
		position: fixed;
		inset: 0;
		z-index: 50;
		display: grid;
		place-items: center;
		padding: 1.5rem;
		background: rgba(12, 15, 20, 0.72);
		backdrop-filter: blur(3px);
		animation: fade 0.18s ease;
	}

	.card {
		position: relative;
		width: min(460px, 100%);
		max-height: 85vh;
		overflow-y: auto;
		padding: 1.75rem;
		border-radius: 20px;
		background: #232a36;
		border: 1px solid rgba(255, 255, 255, 0.12);
		box-shadow: 0 24px 60px rgba(0, 0, 0, 0.45);
		color: #fff;
		animation: rise 0.22s cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.close {
		position: absolute;
		top: 0.9rem;
		right: 0.9rem;
		width: 2rem;
		height: 2rem;
		display: grid;
		place-items: center;
		border: 0;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.08);
		color: rgba(255, 255, 255, 0.75);
		font-size: 1.4rem;
		line-height: 1;
		cursor: pointer;
		transition:
			background 0.15s ease,
			color 0.15s ease;
	}

	.close:hover {
		background: rgba(255, 255, 255, 0.16);
		color: #fff;
	}

	header {
		margin-bottom: 0.85rem;
		padding-right: 2.5rem;
	}

	h2 {
		margin: 0;
		font-size: 1.7rem;
		font-weight: 900;
		letter-spacing: -0.01em;
	}

	.badges {
		display: flex;
		gap: 0.4rem;
		margin-top: 0.5rem;
	}

	.badge {
		padding: 0.15rem 0.55rem;
		border-radius: 999px;
		background: rgba(255, 255, 255, 0.1);
		font-size: 0.7rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.06em;
	}

	.purpose {
		margin: 0 0 0.6rem;
		font-size: 0.98rem;
		line-height: 1.5;
	}

	.topic {
		margin: 0;
		font-size: 0.9rem;
		line-height: 1.45;
		color: rgba(255, 255, 255, 0.62);
	}

	.stats {
		display: flex;
		gap: 2rem;
		margin: 1.4rem 0;
		padding: 1rem 0;
		border-top: 1px solid rgba(255, 255, 255, 0.1);
		border-bottom: 1px solid rgba(255, 255, 255, 0.1);
	}

	.stats div {
		display: grid;
		gap: 0.2rem;
	}

	dt {
		font-size: 0.7rem;
		font-weight: 800;
		text-transform: uppercase;
		letter-spacing: 0.07em;
		color: rgba(255, 255, 255, 0.5);
	}

	dd {
		margin: 0;
		font-size: 1.35rem;
		font-weight: 800;
	}

	.open {
		display: inline-block;
		padding: 0.7rem 1.2rem;
		border-radius: 999px;
		background: #4a7ba7;
		color: #fff;
		font-weight: 800;
		text-decoration: none;
		transition:
			background 0.15s ease,
			transform 0.15s ease;
	}

	.open:hover {
		background: #5a8fbe;
		transform: translateY(-1px);
	}

	.muted {
		color: rgba(255, 255, 255, 0.6);
	}

	.error {
		color: #ff9a9a;
	}

	@keyframes fade {
		from {
			opacity: 0;
		}
	}

	@keyframes rise {
		from {
			opacity: 0;
			transform: translateY(12px) scale(0.97);
		}
	}
</style>
