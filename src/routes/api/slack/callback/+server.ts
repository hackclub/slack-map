import type { RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url }) => {
    const code = url.searchParams.get('code');
    if (!code) {
        return new Response('Missing code parameter', { status: 400 });
    }
    // You would exchange the code for an access token here
    // For now, just return the code for debugging
    return new Response(`Received code: ${code}`, { status: 200 });
};
