import fs from 'fs'
import path from 'path'
import { posts } from '../data/posts.js'
import markdown from 'vite-plugin-md'

const __dirname = path.dirname(new URL(import.meta.url).pathname
const distPath = path.join(__dirname, '../../dist')
const templatePath = path.join(__dirname, '../templates')

// 确保 dist 目录存在
if (!fs.existsSync(distPath)) fs.mkdirSync(distPath, { recursive: true })

// 1. 生成首页
const homeTemplate = fs.readFileSync(path.join(templatePath, 'home.html'), 'utf8')
const homeOutput = homeTemplate
  .replace('{{ content }}', generatePostList(posts))
  .replace('{{ title }}', '首页 | 我的博客')
fs.writeFileSync(path.join(distPath, 'index.html'), homeOutput)

// 2. 生成文章页
posts.forEach(post => {
  const mdContent = fs.readFileSync(
    path.join(__dirname, `../posts/${post.id}.md`), 'utf8'
  )
  
  const postTemplate = fs.readFileSync(
    path.join(templatePath, 'post.html'), 'utf8'
  )
  
  const htmlContent = markdown().transform(mdContent, `${post.id}.md`)
  
  const postOutput = postTemplate
    .replace('{{ content }}', htmlContent)
    .replace('{{ title }}', `${post.title} | 我的博客`)
    .replace('{{ date }}', post.date)
  
  fs.writeFileSync(
    path.join(distPath, `${post.id}.html`),
    postOutput
  )
})

console.log('静态站点生成完成！')

// 生成文章列表的 HTML
function generatePostList(posts) {
  return `
    <section class="post-list">
      <h2>最新文章</h2>
      <ul>
        ${posts.map(post => `
          <li>
            <a href="/${post.id}.html">${post.title}</a>
            <span>${post.date}</span>
          </li>
        `).join('')}
      </ul>
    </section>
  `
}
