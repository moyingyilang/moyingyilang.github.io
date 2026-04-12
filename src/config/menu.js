export const MENU_DATA = [
  {
    label: "科创",
    path: "tech",
    children: [
      { label: "物理-电", path: "physics-e" },
      { label: "物理-力", path: "physics-f" },
      { label: "化学", path: "chemistry" },
      { label: "技巧/小知识", path: "tips" }
    ]
  },
  {
    label: "代码",
    path: "code",
    children: [
      { label: "容器", path: "container" },
      { label: "开发语言", path: "language" },
      { label: "开发环境", path: "env" }
    ]
  },
  {
    label: "小知识/随笔",
    path: "notes",
    children: [
      { label: "开发者目前研究项目", path: "dev-projects" },
      { label: "项目往事及进度", path: "project-history" },
      { label: "部分游戏总结的攻略", path: "game-guides" },
      { label: "pcb设计和电路原理等", path: "pcb" },
      { label: "刷机圈小瓜", path: "flash-gossip" },
      { label: "git项目监控引擎", path: "git-monitor" }
    ]
  },
  { label: "杂项工具", path: "tools" },
  { label: "常见问题", path: "faq" },
  { label: "关于", path: "about" }
];
