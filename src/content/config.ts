import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  schema: z.object({
    title: z.string(),
    date: z.string(),
    prev: z.string().optional(),
    next: z.string().optional(),
  }),
});

export const collections = { blog };
