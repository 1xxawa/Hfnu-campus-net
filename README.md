# Hfnu-campus-net - 合师滨湖校区校园网自动登录工具

一个基于 Tauri 2.0 构建的校园网自动登录桌面应用，支持自动连接/手动断开、公告查看、自动更新等功能。   
请勿与代理工具一同使用

## 主界面

<img width="634" height="1009" alt="image" src="https://github.com/user-attachments/assets/1f0cdfbf-6463-4473-96da-faafa99f11b1" />


## 主题设置（点击左上角文字打开）

<img width="871" height="1009" alt="image" src="https://github.com/user-attachments/assets/b7d217da-9ee4-4dfe-9ecc-563e834961e6" />


## 日志界面（点击下方IP地址打开）

<img width="634" height="1009" alt="image" src="https://github.com/user-attachments/assets/9252ab58-575c-46a8-990b-465693339f21" />

## 托盘功能
<img width="253" height="249" alt="image" src="https://github.com/user-attachments/assets/c56a1543-2624-4951-a673-7ca782562874" />


## 特点

### 连接机制
- 自动等待校园网界面加载后连接，避免连接失败
- 连接失败后自动重试，增加容错率
- 支持开机自启动
- 支持启动时隐藏窗口

### 公告功能
- 从远程服务器获取公告列表
- 未读公告提示
- 公告内容支持链接点击复制

### 自动更新
- 自动检查新版本
- 一键下载更新

### 主题定制
- 自定义主题颜色
- 自定义按钮透明度
- 自定义圆角大小

## 技术栈

- **前端**: HTML, CSS, JavaScript
- **后端**: Rust, Tauri 2.0
- **构建工具**: pnpm, Vite

## 开发环境

### 前置要求

- [Node.js](https://nodejs.org/) (推荐 v18+)
- [pnpm](https://pnpm.io/) 
- [Rust](https://www.rust-lang.org/)
- [Tauri 2.0](https://v2.tauri.app/)

### 安装依赖

```bash
pnpm install
```

### 开发模式

```bash
pnpm tauri dev
```

### 构建发布

```bash
pnpm tauri build
```

## 项目结构

```
campus-net-login/
├── src/                    # 前端源码
│   ├── index.html         # 主页面
│   ├── main.js            # 主逻辑
│   └── styles.css         # 样式
├── src-tauri/             # 后端源码
│   ├── src/
│   │   ├── lib.rs         # 核心逻辑
│   │   └── main.rs        # 入口
│   ├── Cargo.toml         # Rust 依赖
│   ├── tauri.conf.json    # Tauri 配置
│   └── capabilities/      # 权限配置
├── package.json           # Node 依赖
└── README.md
```

## 配置说明

### 保存配置
应用会自动保存以下配置到本地：
- 学号和密码（可选）
- 运营商选择
- 主题设置
- 开机自启动设置

### 公告配置
公告从远程 JSON 文件获取，格式如下：
```json
[
  "https://example.com/announcement1.txt",
  "https://example.com/announcement2.txt"
]
```

公告文件格式：
```
--公告标题

公告内容

--上传人
```

### 更新配置
更新信息从远程 JSON 文件获取，格式如下：
```json
{
  "version": "v1.0.7",
  "notes": "更新说明",
  "pub_date": "2026-03-07T12:00:00Z",
  "platforms": {
    "windows-x86_64": {
      "signature": "",
      "url": "https://example.com/update.msi"
    }
  }
}
```

## 作者

yxxawa
