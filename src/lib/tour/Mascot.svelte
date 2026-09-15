<script lang="ts">
	import type { Mood } from './steps.js';

	export let mood: Mood = 'idle';
	/** Bounces Orpheus gently while the dialogue is still typing out. */
	export let talking = false;
</script>

<!--
	Orpheus is a single hand-drawn pose (Hack Club's orpheus-wave art), so each
	mood is motion rather than a different drawing. Every transform lives on its
	own element — mood on .motion, talking on the img — so one animation never
	overwrites another's transform.
-->
<div class="mascot" class:talking data-mood={mood} aria-hidden="true">
	<div class="motion">
		<img src="/orpheus-wave.png" alt="" width="427" height="585" draggable="false" />
	</div>
</div>

<style>
	.mascot {
		width: 100%;
	}

	.motion {
		transform-origin: 50% 100%;
		animation: bob 2.6s ease-in-out infinite;
	}

	img {
		display: block;
		width: 100%;
		height: auto;
		transform-origin: 50% 100%;
		filter: drop-shadow(0 8px 14px rgba(0, 0, 0, 0.45));
		user-select: none;
	}

	.talking img {
		animation: talk 0.32s ease-in-out infinite alternate;
	}

	[data-mood='wave'] .motion {
		animation: wave 1.1s ease-in-out infinite;
	}

	/* Leans toward the bubble; the dock mirrors Orpheus to face it. */
	[data-mood='point'] .motion {
		animation: lean 2.6s ease-in-out infinite;
	}

	[data-mood='think'] .motion {
		animation: think 3.2s ease-in-out infinite;
	}

	[data-mood='cheer'] .motion {
		animation: hop 0.45s ease-out infinite alternate;
	}

	@keyframes bob {
		50% { transform: translateY(-4px); }
	}

	@keyframes wave {
		0%, 100% { transform: rotate(-4deg); }
		50% { transform: rotate(4deg); }
	}

	@keyframes lean {
		0%, 100% { transform: rotate(-6deg) translateY(0); }
		50% { transform: rotate(-6deg) translateY(-4px); }
	}

	@keyframes think {
		0%, 100% { transform: rotate(-3deg); }
		50% { transform: rotate(2deg) translateY(-2px); }
	}

	@keyframes hop {
		to { transform: translateY(-12px); }
	}

	@keyframes talk {
		to { transform: scale(1.02, 0.975); }
	}

	@media (prefers-reduced-motion: reduce) {
		.motion,
		img {
			animation: none !important;
		}
	}
</style>