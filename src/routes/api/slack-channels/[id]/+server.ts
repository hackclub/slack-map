import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ params }) => {
	const token = env.SLACK_BOT_TOKEN;
	const channelId = params.id;

	if (!token) {
		console.error('Missing Slack token');
		return new Response(JSON.stringify({ error: 'Missing Slack token' }), { status: 500 });
	}

	if (!channelId) {
		return new Response(JSON.stringify({ error: 'Missing channel id' }), { status: 400 });
	}

	try {
		const response = await fetch(
			`https://slack.com/api/conversations.info?channel=${encodeURIComponent(channelId)}&include_num_members=true`,
			{
				headers: {
					Authorization: `Bearer ${token}`
				}
			}
		);
		const data = await response.json();

		if (!data.ok) {
			console.error('Slack API error:', data.error);
			return new Response(JSON.stringify({ error: data.error }), { status: 500 });
		}

		return new Response(JSON.stringify({ channel: data.channel }), { status: 200 });
	} catch (error) {
		console.error('Fetch error:', error);
		return new Response(
			JSON.stringify({ error: 'Fetch error', details: String(error) }),
			{ status: 500 }
		);
	}
};
