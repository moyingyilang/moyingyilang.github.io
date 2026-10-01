import rss from '@astrojs/rss';
import { SITE_DESCRIPTION, SITE_TITLE } from '../consts';
import { getSortedPosts, postHref } from '../utils/posts';

export async function GET(context) {
	const posts = await getSortedPosts();

	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site,
		customData: '<language>zh-CN</language>',
		items: posts.map((post) => {
			const date = post.data.date ?? post.data.pubDate;
			return {
				title: post.data.title,
				description: post.data.description ?? '',
				link: postHref(post),
				...(date ? { pubDate: date } : {}),
				categories: [...(post.data.tags ?? []), ...(post.data.category ? [post.data.category] : [])],
			};
		}),
	});
}
