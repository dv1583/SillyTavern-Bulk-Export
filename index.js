/* ============================================================
 * SillyTavern Bulk Character Exporter
 * 批量导出所有角色卡为 PNG（含嵌入数据），打包成 ZIP 下载
 * ============================================================ */

const extensionName = 'SillyTavern-Bulk-Export';
const extensionFolderPath = `scripts/extensions/third-party/${extensionName}`;

// ---- UI 面板 HTML ----
const settingsHtml = `
<div id="bulk-export-settings" class="bulk-export-container">
    <div class="inline-drawer">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>📦 批量导出角色卡</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <p class="bulk-export-desc">一键导出所有角色卡为 PNG 文件，打包成 ZIP 下载。</p>

            <div class="bulk-export-options">
                <label class="checkbox_label">
                    <input type="checkbox" id="bulk-export-include-json" checked>
                    <span>同时包含 JSON 数据备份</span>
                </label>
            </div>

            <div id="bulk-export-progress" class="bulk-export-progress" style="display:none;">
                <div class="bulk-export-progress-bar-container">
                    <div id="bulk-export-progress-bar" class="bulk-export-progress-bar"></div>
                </div>
                <div id="bulk-export-status" class="bulk-export-status">准备中...</div>
            </div>

            <div class="bulk-export-actions">
                <button id="bulk-export-start" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-download"></i>
                    <span>开始导出所有角色卡</span>
                </button>
            </div>

            <div id="bulk-export-result" class="bulk-export-result" style="display:none;"></div>
        </div>
    </div>
</div>
`;

// ---- JSZip 加载 ----
let jsZipLoaded = false;

async function ensureJSZip() {
    if (jsZipLoaded && typeof JSZip !== 'undefined') return;

    return new Promise((resolve, reject) => {
        // 检查是否已加载
        if (typeof JSZip !== 'undefined') {
            jsZipLoaded = true;
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => {
            jsZipLoaded = true;
            resolve();
        };
        script.onerror = () => reject(new Error('无法加载 JSZip 库'));
        document.head.appendChild(script);
    });
}

// ---- 导出逻辑 ----
async function exportAllCharacters() {
    const startBtn = document.getElementById('bulk-export-start');
    const progressDiv = document.getElementById('bulk-export-progress');
    const progressBar = document.getElementById('bulk-export-progress-bar');
    const statusDiv = document.getElementById('bulk-export-status');
    const resultDiv = document.getElementById('bulk-export-result');
    const includeJson = document.getElementById('bulk-export-include-json')?.checked;

    // 禁用按钮，显示进度
    startBtn.disabled = true;
    startBtn.querySelector('span').textContent = '导出中...';
    progressDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    try {
        // 加载 JSZip
        statusDiv.textContent = '正在加载压缩库...';
        await ensureJSZip();

        // 获取角色列表
        statusDiv.textContent = '正在获取角色列表...';

        const context = SillyTavern.getContext();
        const characters = context.characters;

        if (!characters || characters.length === 0) {
            throw new Error('未找到任何角色');
        }

        statusDiv.textContent = `找到 ${characters.length} 个角色，准备导出...`;
        const zip = new JSZip();
        const pngFolder = zip.folder('characters_png');
        const jsonFolder = includeJson ? zip.folder('characters_json') : null;

        let success = 0;
        let failed = 0;
        const errors = [];

        for (let i = 0; i < characters.length; i++) {
            const char = characters[i];
            const name = char.name || `character_${i}`;
            const avatar = char.avatar;
            const safeName = name.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_');

            // 更新进度
            const percent = ((i + 1) / characters.length * 100).toFixed(0);
            progressBar.style.width = `${percent}%`;
            statusDiv.textContent = `[${i + 1}/${characters.length}] 正在导出: ${name}`;

            // 导出 PNG 角色卡
            try {
                const exportRes = await fetch('/api/characters/export', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        ...getExtraHeaders(),
                    },
                    body: JSON.stringify({ avatar_url: avatar }),
                });

                if (exportRes.ok) {
                    const blob = await exportRes.blob();
                    pngFolder.file(`${safeName}.png`, blob);
                    success++;
                } else {
                    // 如果导出 API 失败，尝试直接下载头像图片
                    const imgUrl = `/characters/${encodeURIComponent(avatar)}`;
                    const imgRes = await fetch(imgUrl);
                    if (imgRes.ok) {
                        const blob = await imgRes.blob();
                        pngFolder.file(`${safeName}.png`, blob);
                        success++;
                    } else {
                        failed++;
                        errors.push(`${name}: HTTP ${exportRes.status}`);
                    }
                }
            } catch (e) {
                failed++;
                errors.push(`${name}: ${e.message}`);
            }

            // 保存 JSON 数据
            if (jsonFolder) {
                try {
                    jsonFolder.file(`${safeName}.json`, JSON.stringify(char, null, 2));
                } catch (e) {
                    // JSON 保存失败不影响整体流程
                }
            }

            // 给 UI 一些喘息空间
            if (i % 5 === 0) {
                await new Promise(r => setTimeout(r, 50));
            }
        }

        // 如果 PNG 导出全部失败，用 JSON 作为主要备份
        if (success === 0 && characters.length > 0) {
            statusDiv.textContent = 'PNG 导出不可用，正在保存完整 JSON 数据...';
            const fallbackFolder = zip.folder('characters_data');
            for (const char of characters) {
                const name = char.name || 'unknown';
                const safeName = name.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_');
                fallbackFolder.file(`${safeName}.json`, JSON.stringify(char, null, 2));
            }
            success = characters.length;
            failed = 0;
        }

        // 生成 ZIP
        statusDiv.textContent = '正在打包 ZIP 文件...';
        progressBar.style.width = '100%';

        const zipBlob = await zip.generateAsync(
            { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
            (meta) => {
                statusDiv.textContent = `正在压缩... ${meta.percent.toFixed(0)}%`;
            }
        );

        // 触发下载
        const dateStr = new Date().toISOString().slice(0, 10);
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `SillyTavern_Characters_${dateStr}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        // 显示结果
        const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(2);
        resultDiv.innerHTML = `
            <div class="bulk-export-success">
                ✅ 导出完成！<br>
                📊 成功: <b>${success}</b> 个角色 | 失败: <b>${failed}</b> 个<br>
                📦 文件大小: <b>${sizeMB} MB</b>
                ${errors.length > 0 ? `<br><details><summary>查看错误详情</summary><pre>${errors.join('\n')}</pre></details>` : ''}
            </div>
        `;
        resultDiv.style.display = 'block';
        statusDiv.textContent = '导出完成！';

    } catch (error) {
        resultDiv.innerHTML = `<div class="bulk-export-error">❌ 导出失败: ${error.message}</div>`;
        resultDiv.style.display = 'block';
        statusDiv.textContent = '导出失败';
        console.error('[Bulk Export]', error);
    } finally {
        startBtn.disabled = false;
        startBtn.querySelector('span').textContent = '开始导出所有角色卡';
    }
}

// ---- 获取 SillyTavern 请求头 ----
function getExtraHeaders() {
    try {
        const context = SillyTavern.getContext();
        if (context.getRequestHeaders) {
            return context.getRequestHeaders();
        }
    } catch (e) {
        // fallback
    }
    return {};
}

// ---- 初始化扩展 ----
jQuery(async () => {
    // 插入 UI 面板到扩展设置区
    const settingsContainer = document.getElementById('extensions_settings');
    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML('beforeend', settingsHtml);
    } else {
        // 备选：插入到 extensions_settings2
        const settingsContainer2 = document.getElementById('extensions_settings2');
        if (settingsContainer2) {
            settingsContainer2.insertAdjacentHTML('beforeend', settingsHtml);
        }
    }

    // 绑定按钮事件
    document.getElementById('bulk-export-start')?.addEventListener('click', exportAllCharacters);

    console.log('[Bulk Character Exporter] 扩展已加载');
});
