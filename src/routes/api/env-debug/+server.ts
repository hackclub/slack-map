import { env } from '$env/dynamic/private';
import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async () => {
	// Only show non-sensitive variables for safety
	const filteredEnv = Object.fromEntries(
		Object.entries(env).filter(([key]) => key.includes('SLACK') || key.includes('VITE'))
	);

	return new Response(JSON.stringify(filteredEnv, null, 2), {
		status: 200,
		headers: { 'Content-Type': 'application/json' }
	});
};
