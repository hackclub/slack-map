export type SlackChannel = {
	id: string;
	name: string;
	is_private?: boolean;
	is_archived?: boolean;
	num_members?: number;
};

export type SlackChannelDetails = SlackChannel & {
	topic?: { value?: string };
	purpose?: { value?: string };
	created?: number;
	num_members?: number;
};

const SLACK_WORKSPACE = 'hackclub';

export function channelUrl(channelId: string): string {
	return `https://${SLACK_WORKSPACE}.slack.com/archives/${channelId}`;
}

export function formatSlackText(text: string | undefined) {
	if (!text) return '';
	return text
		.replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
		.replace(/<#([A-Z0-9]+)>/g, '#channel')
		.replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
		.replace(/<(https?:[^>]+)>/g, '$1')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>');
}


async function readJson<T>(response: Response): Promise<T> {
	const payload = await response.json();

	if (!response.ok) {
		const message =
			typeof payload?.error === 'string'
				? payload.error
				: typeof payload?.details === 'string'
					? payload.details
					: 'Request failed';
		throw new Error(message);
	}

	return payload as T;
}

export async function fetchChannels(options?: { refresh?: boolean }): Promise<SlackChannel[]> {
	return (await fetchChannelList(options)).channels;
}

/**
 * The channel list plus whether the server is still crawling for more.
 *
 * `refresh` tells the server to drop its cache — used by the retry button.
 */
export async function fetchChannelList(options?: {
	refresh?: boolean;
}): Promise<{ channels: SlackChannel[]; crawling: boolean }> {
	const url = options?.refresh ? '/api/slack-channels?refresh=1' : '/api/slack-channels';
	// no-store: a poll must never be answered from the browser's own cache with
	// the partial list it is polling to replace.
	const response = await fetch(url, { cache: 'no-store' });
	const payload = await readJson<{ channels: SlackChannel[]; crawling?: boolean }>(response);
	return { channels: payload.channels, crawling: payload.crawling ?? false };
}

export async function fetchChannelInfo(channelId: string): Promise<SlackChannelDetails> {
	const response = await fetch(`/api/slack-channels/${channelId}`);
	const payload = await readJson<{ channel: SlackChannelDetails }>(response);
	return payload.channel;
}
