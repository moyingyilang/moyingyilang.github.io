import { getCollection } from 'astro:content';

// 递归生成多级菜单树（按文件夹路径自动拆分）
export async function getDocMenuTree() {
  const docs = await getCollection('docs');
  const menuTree: any[] = [];

  docs.forEach(doc => {
    const paths = doc.slug.split('/'); // 按 / 拆分多级路径
    let currentLevel = menuTree;

    paths.forEach((path, index) => {
      const isLast = index === paths.length - 1;
      const existing = currentLevel.find(item => item.label === path);

      if (existing) {
        currentLevel = existing.children || (existing.children = []);
      } else {
        const newItem: any = {
          label: path.replace(/-/g, ' '), // 横杠转空格
          slug: doc.slug,
          children: [],
        };
        if (isLast) newItem.href = `/docs/${doc.slug}`;
        currentLevel.push(newItem);
        currentLevel = newItem.children;
      }
    });
  });

  // 清理空children
  const cleanTree = (items: any[]) => {
    items.forEach(item => {
      if (item.children?.length === 0) delete item.children;
      else cleanTree(item.children);
    });
  };
  cleanTree(menuTree);
  return menuTree;
}
