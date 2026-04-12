import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

// https://astro.build/config
export default defineConfig({
  site: 'https://luyaoqisen.github.io', // 改成你的域名
  integrations: [tailwind()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark', // 代码高亮主题
    },
  },
});
