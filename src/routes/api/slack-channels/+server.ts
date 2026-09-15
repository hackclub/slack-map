import type { RequestHandler } from '@sveltejs/kit';
import { getChannels, invalidateChannels } from '$lib/server/slackCache.js';

export const GET: RequestHandler = async ({ url }) => {
	// ?refresh=1 backs the page's "Try again" button.
	if (url.searchParams.get('refresh')) invalidateChannels();

	try {
		const { channels, state, crawling, error } = await getChannels();

		return new Response(JSON.stringify({ channels, state, crawling, error }), {
			status: 200,
			headers: {
				'content-type': 'application/json',
				// Browsers may reuse this briefly; the server cache does the real work.
				// Not while a crawl is running, or the page polling for the rest of the
				// workspace would keep being handed the partial list it already has.
				'cache-control': crawling
					? 'no-store'
					: 'public, max-age=60, stale-while-revalidate=300'
			}
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Fetch error';
		console.error('slack-channels failed:', message);
		return new Response(JSON.stringify({ error: message }), {
			status: 500,
			headers: { 'content-type': 'application/json' }
		});
	}
};
