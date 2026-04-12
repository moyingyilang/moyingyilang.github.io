// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const docs = defineCollection({
	type: 'content',
	schema: z.object({
		title: z.string(),
	}),
});

export const collections = { docs };
