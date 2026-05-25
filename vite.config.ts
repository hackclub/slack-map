import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		allowedHosts: [
			'82d4-2401-4900-1cd6-7f34-a4d0-a3e9-9f81-93ae.ngrok-free.app',
			'waterlogged-abbie-linear.ngrok-free.dev'
		]
	}
});
