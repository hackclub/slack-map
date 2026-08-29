import { getChannels } from '$lib/server/slackCache.js';
import type { PageServerLoad } from './$types.js';

/**
 * Channels are loaded here rather than in onMount so the server-rendered HTML
 * already contains them. Fetching on the client meant the first paint always
 * showed "No channels yet" until the request came back.
 */
export const load: PageServerLoad = async () => {
	try {
		const { channels, state, error } = await getChannels();
		return { channels, cacheState: state, loadError: error ?? '' };
	} catch (error) {
		// Render the map anyway; the page keeps its retry button.
		return {
			channels: [],
			cacheState: 'miss' as const,
			loadError: error instanceof Error ? error.message : 'Unable to load workspace'
		};
	}
};
