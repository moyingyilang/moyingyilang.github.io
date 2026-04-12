# 1. 创建docs集合必需的文件夹
mkdir -p src/content/docs

# 2. 创建一篇测试文档（让集合不为空）
cat > src/content/docs/hello.md << EOF
---
title: 欢迎使用自动菜单
date: 2026-04-12
---

# 测试文章
这是自动生成菜单的测试文档，文件夹结构会自动变成多级菜单！
EOF

# 3. 重启开发服务
pnpm dev
