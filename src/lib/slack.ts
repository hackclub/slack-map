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
};

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

export async function fetchChannels(): Promise<SlackChannel[]> {
	const response = await fetch('/api/slack-channels');
	const payload = await readJson<{ channels: SlackChannel[] }>(response);
	return payload.channels;
}

export async function fetchChannelInfo(channelId: string): Promise<SlackChannelDetails> {
	const response = await fetch(`/api/slack-channels/${channelId}`);
	const payload = await readJson<{ channel: SlackChannelDetails }>(response);
	return payload.channel;
}
