# SillyTavern Bulk Character Exporter

一键批量导出 SillyTavern 中所有角色卡的扩展。

## 功能

- ✅ 批量导出所有角色卡为 **PNG 格式**（含嵌入的完整角色数据）
- ✅ 可选同时导出 **JSON 数据备份**
- ✅ 自动打包为 **ZIP 文件**下载
- ✅ 实时显示导出进度
- ✅ 多重降级策略：PNG 导出 API → 直接图片下载 → JSON 数据备份

## 安装方法

### 方法一：通过 SillyTavern 扩展安装器（推荐）

1. 将此仓库上传到 GitHub
2. 在 SillyTavern 中打开 **扩展面板**（顶栏的积木图标）
3. 点击 **"Install Extension"**
4. 粘贴 GitHub 仓库 URL
5. 安装完成后刷新页面

### 方法二：手动安装

将整个 `SillyTavern-Bulk-Export` 文件夹复制到 SillyTavern 的扩展目录：

```
SillyTavern/data/<user-handle>/extensions/SillyTavern-Bulk-Export/
```

或者：

```
SillyTavern/public/scripts/extensions/third-party/SillyTavern-Bulk-Export/
```

## 使用方法

1. 打开 SillyTavern
2. 点击顶栏 **扩展面板**（积木图标）
3. 找到 **"📦 批量导出角色卡"** 面板
4. 点击 **"开始导出所有角色卡"**
5. 等待导出完成，ZIP 文件会自动下载

## 文件结构

```
SillyTavern-Bulk-Export/
├── manifest.json   # 扩展元数据
├── index.js        # 主逻辑
├── style.css       # UI 样式
└── README.md       # 说明文档
```

## 许可证

AGPLv3
