/* ============================================================
 * SillyTavern Bulk Character Exporter v2.0
 * 支持分段导出，避免浏览器内存溢出
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
            <p class="bulk-export-desc">分段导出所有角色卡为 PNG 文件，每段打包成独立 ZIP 下载。</p>

            <div class="bulk-export-options">
                <div class="bulk-export-option-row">
                    <label for="bulk-export-batch-size">每段角色数量：</label>
                    <select id="bulk-export-batch-size">
                        <option value="30">30 个/段（推荐，最稳定）</option>
                        <option value="50" selected>50 个/段（推荐）</option>
                        <option value="80">80 个/段</option>
                        <option value="100">100 个/段</option>
                        <option value="150">150 个/段</option>
                        <option value="200">200 个/段</option>
                    </select>
                </div>

                <div class="bulk-export-option-row">
                    <label for="bulk-export-start-from">从第几个角色开始：</label>
                    <input type="number" id="bulk-export-start-from" value="1" min="1" style="width:80px;">
                    <span id="bulk-export-total-count" class="bulk-export-hint"></span>
                </div>

                <div class="bulk-export-option-row">
                    <label for="bulk-export-end-at">到第几个角色结束（留空=全部）：</label>
                    <input type="number" id="bulk-export-end-at" value="" min="1" style="width:80px;" placeholder="全部">
                </div>

                <label class="checkbox_label">
                    <input type="checkbox" id="bulk-export-include-json">
                    <span>同时包含 JSON 数据备份</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="bulk-export-auto-next" checked>
                    <span>自动继续下一段（段间暂停 3 秒释放内存）</span>
                </label>

                <label class="checkbox_label">
                    <input type="checkbox" id="bulk-export-only-failed">
                    <span>仅重新导出上次失败的角色</span>
                </label>
            </div>

            <div id="bulk-export-progress" class="bulk-export-progress" style="display:none;">
                <div class="bulk-export-progress-bar-container">
                    <div id="bulk-export-progress-bar" class="bulk-export-progress-bar"></div>
                </div>
                <div id="bulk-export-batch-info" class="bulk-export-batch-info"></div>
                <div id="bulk-export-status" class="bulk-export-status">准备中...</div>
            </div>

            <div class="bulk-export-actions">
                <button id="bulk-export-start" class="menu_button menu_button_icon">
                    <i class="fa-solid fa-download"></i>
                    <span>开始分段导出</span>
                </button>
                <button id="bulk-export-stop" class="menu_button menu_button_icon" style="display:none;">
                    <i class="fa-solid fa-stop"></i>
                    <span>停止导出</span>
                </button>
            </div>

            <div id="bulk-export-result" class="bulk-export-result" style="display:none;"></div>
        </div>
    </div>
</div>
`;

// ---- 全局状态 ----
let isExporting = false;
let shouldStop = false;
let failedCharacters = []; // 记录失败的角色，供重试使用

// ---- JSZip 加载 ----
let jsZipLoaded = false;

async function ensureJSZip() {
    if (jsZipLoaded && typeof JSZip !== 'undefined') return;
    return new Promise((resolve, reject) => {
        if (typeof JSZip !== 'undefined') { jsZipLoaded = true; resolve(); return; }
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = () => { jsZipLoaded = true; resolve(); };
        script.onerror = () => reject(new Error('无法加载 JSZip 库'));
        document.head.appendChild(script);
    });
}

// ---- 获取 SillyTavern 请求头 ----
function getExtraHeaders() {
    try {
        const context = SillyTavern.getContext();
        if (context.getRequestHeaders) return context.getRequestHeaders();
    } catch (e) {}
    return {};
}

// ---- 单个角色导出 ----
async function exportSingleCharacter(char, index) {
    const name = char.name || `character_${index}`;
    const avatar = char.avatar;

    try {
        const exportRes = await fetch('/api/characters/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getExtraHeaders() },
            body: JSON.stringify({ avatar_url: avatar }),
        });

        if (exportRes.ok) {
            const blob = await exportRes.blob();
            return { success: true, blob, name };
        }

        // 降级：尝试直接下载头像
        const imgUrl = `/characters/${encodeURIComponent(avatar)}`;
        const imgRes = await fetch(imgUrl);
        if (imgRes.ok) {
            const blob = await imgRes.blob();
            return { success: true, blob, name };
        }

        return { success: false, name, error: `HTTP ${exportRes.status}` };
    } catch (e) {
        return { success: false, name, error: e.message };
    }
}

// ---- 下载一个 Blob ----
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // 延迟释放，确保下载已开始
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- 主导出逻辑（分段） ----
async function exportAllCharacters() {
    if (isExporting) return;
    isExporting = true;
    shouldStop = false;

    const startBtn = document.getElementById('bulk-export-start');
    const stopBtn = document.getElementById('bulk-export-stop');
    const progressDiv = document.getElementById('bulk-export-progress');
    const progressBar = document.getElementById('bulk-export-progress-bar');
    const batchInfoDiv = document.getElementById('bulk-export-batch-info');
    const statusDiv = document.getElementById('bulk-export-status');
    const resultDiv = document.getElementById('bulk-export-result');
    const includeJson = document.getElementById('bulk-export-include-json')?.checked;
    const autoNext = document.getElementById('bulk-export-auto-next')?.checked;
    const onlyFailed = document.getElementById('bulk-export-only-failed')?.checked;
    const batchSize = parseInt(document.getElementById('bulk-export-batch-size')?.value || '50');
    const startFrom = parseInt(document.getElementById('bulk-export-start-from')?.value || '1') - 1;
    const endAtInput = document.getElementById('bulk-export-end-at')?.value;

    startBtn.style.display = 'none';
    stopBtn.style.display = '';
    progressDiv.style.display = 'block';
    resultDiv.style.display = 'none';

    try {
        statusDiv.textContent = '正在加载压缩库...';
        await ensureJSZip();

        statusDiv.textContent = '正在获取角色列表...';
        const context = SillyTavern.getContext();

        let characters;
        if (onlyFailed && failedCharacters.length > 0) {
            // 重试模式：使用上次失败的角色列表
            characters = failedCharacters.map(fc => {
                return context.characters.find(c => c.name === fc.name || c.avatar === fc.avatar) || fc;
            }).filter(Boolean);
            statusDiv.textContent = `重试模式：${characters.length} 个之前失败的角色`;
        } else {
            characters = context.characters;
            if (!characters || characters.length === 0) throw new Error('未找到任何角色');
        }

        const endAt = endAtInput ? Math.min(parseInt(endAtInput), characters.length) : characters.length;
        const targetChars = characters.slice(startFrom, endAt);
        const totalChars = targetChars.length;
        const totalBatches = Math.ceil(totalChars / batchSize);

        statusDiv.textContent = `共 ${totalChars} 个角色，分 ${totalBatches} 段导出，每段 ${batchSize} 个`;

        let globalSuccess = 0;
        let globalFailed = 0;
        const newFailedCharacters = [];
        const dateStr = new Date().toISOString().slice(0, 10);

        // ---- 分段循环 ----
        for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
            if (shouldStop) {
                statusDiv.textContent = '已手动停止';
                break;
            }

            const batchStart = batchIdx * batchSize;
            const batchEnd = Math.min(batchStart + batchSize, totalChars);
            const batchChars = targetChars.slice(batchStart, batchEnd);
            const batchNum = batchIdx + 1;
            const globalOffset = startFrom + batchStart;

            batchInfoDiv.textContent = `📦 第 ${batchNum}/${totalBatches} 段 | 角色 ${globalOffset + 1}-${globalOffset + batchChars.length} / ${characters.length}`;

            const zip = new JSZip();
            const pngFolder = zip.folder('characters');
            const jsonFolder = includeJson ? zip.folder('characters_json') : null;

            let batchSuccess = 0;
            let batchFailed = 0;

            for (let i = 0; i < batchChars.length; i++) {
                if (shouldStop) break;

                const char = batchChars[i];
                const charGlobalIdx = globalOffset + i;
                const name = char.name || `character_${charGlobalIdx}`;
                const safeName = name.replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_');

                // 更新进度
                const overallProgress = ((globalOffset + batchStart + i + 1) / totalChars * 100);
                const batchProgress = ((i + 1) / batchChars.length * 100);
                progressBar.style.width = `${batchProgress.toFixed(0)}%`;
                statusDiv.textContent = `[${charGlobalIdx + 1}/${characters.length}] 正在导出: ${name}`;

                const result = await exportSingleCharacter(char, charGlobalIdx);

                if (result.success) {
                    // 用角色序号作为前缀避免重名
                    pngFolder.file(`${String(charGlobalIdx + 1).padStart(4, '0')}_${safeName}.png`, result.blob);
                    batchSuccess++;
                    globalSuccess++;
                    // 主动释放 blob 引用
                    result.blob = null;
                } else {
                    batchFailed++;
                    globalFailed++;
                    newFailedCharacters.push({
                        name: char.name,
                        avatar: char.avatar,
                        error: result.error,
                    });
                }

                // JSON 备份
                if (jsonFolder) {
                    try {
                        jsonFolder.file(`${String(charGlobalIdx + 1).padStart(4, '0')}_${safeName}.json`, JSON.stringify(char, null, 2));
                    } catch (e) {}
                }

                // 每 5 个角色暂停一下，给浏览器喘息
                if (i % 5 === 4) {
                    await new Promise(r => setTimeout(r, 100));
                }
            }

            if (shouldStop) break;

            // 只有有成功的角色才生成 ZIP
            if (batchSuccess > 0) {
                statusDiv.textContent = `正在打包第 ${batchNum} 段 ZIP...`;
                progressBar.style.width = '100%';

                const zipBlob = await zip.generateAsync(
                    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
                    (meta) => {
                        statusDiv.textContent = `第 ${batchNum} 段压缩中... ${meta.percent.toFixed(0)}%`;
                    }
                );

                const sizeMB = (zipBlob.size / 1024 / 1024).toFixed(1);
                const fileName = `ST_Characters_${dateStr}_part${String(batchNum).padStart(2, '0')}_of_${totalBatches}.zip`;
                statusDiv.textContent = `第 ${batchNum} 段下载中... (${sizeMB} MB)`;

                downloadBlob(zipBlob, fileName);
            }

            // 段间暂停释放内存
            if (batchIdx < totalBatches - 1 && autoNext) {
                for (let sec = 3; sec > 0; sec--) {
                    statusDiv.textContent = `第 ${batchNum} 段完成 ✅ (成功: ${batchSuccess}, 失败: ${batchFailed}) | ${sec} 秒后开始下一段...`;
                    await new Promise(r => setTimeout(r, 1000));
                    if (shouldStop) break;
                }
            } else if (batchIdx < totalBatches - 1 && !autoNext) {
                // 手动模式：更新 start-from 并停止
                document.getElementById('bulk-export-start-from').value = globalOffset + batchChars.length + 1;
                statusDiv.textContent = `第 ${batchNum} 段完成 ✅ | 已更新起始位置为 ${globalOffset + batchChars.length + 1}，请手动点击继续`;
                break;
            }

            // 重置进度条
            progressBar.style.width = '0%';
        }

        // 保存失败列表供重试
        failedCharacters = newFailedCharacters;

        // 显示总结果
        const failedDetails = newFailedCharacters.map(f => `${f.name}: ${f.error}`).join('\n');
        resultDiv.innerHTML = `
            <div class="bulk-export-success">
                🎉 导出完成！<br>
                📊 总计成功: <b>${globalSuccess}</b> 个角色 | 失败: <b>${globalFailed}</b> 个<br>
                📦 共 ${Math.min(Math.ceil(globalSuccess / batchSize), Math.ceil((globalSuccess + globalFailed) / batchSize))} 个 ZIP 文件
                ${globalFailed > 0 ? `<br>💡 可勾选 <b>"仅重新导出上次失败的角色"</b> 后再次点击导出来重试失败的角色` : ''}
                ${globalFailed > 0 ? `<br><details><summary>查看失败详情 (${globalFailed} 个)</summary><pre>${failedDetails}</pre></details>` : ''}
            </div>
        `;
        resultDiv.style.display = 'block';

        if (globalFailed > 0) {
            document.getElementById('bulk-export-only-failed').parentElement.style.display = '';
        }

    } catch (error) {
        resultDiv.innerHTML = `<div class="bulk-export-error">❌ 导出失败: ${error.message}</div>`;
        resultDiv.style.display = 'block';
        statusDiv.textContent = '导出失败';
        console.error('[Bulk Export]', error);
    } finally {
        isExporting = false;
        shouldStop = false;
        startBtn.style.display = '';
        stopBtn.style.display = 'none';
        startBtn.querySelector('span').textContent = '开始分段导出';
    }
}

// ---- 停止导出 ----
function stopExport() {
    shouldStop = true;
    const statusDiv = document.getElementById('bulk-export-status');
    if (statusDiv) statusDiv.textContent = '正在停止...';
}

// ---- 更新角色总数显示 ----
function updateTotalCount() {
    try {
        const context = SillyTavern.getContext();
        const total = context.characters?.length || 0;
        const countSpan = document.getElementById('bulk-export-total-count');
        if (countSpan) countSpan.textContent = `(共 ${total} 个角色)`;
    } catch (e) {}
}

// ---- 初始化扩展 ----
jQuery(async () => {
    const settingsContainer = document.getElementById('extensions_settings')
        || document.getElementById('extensions_settings2');

    if (settingsContainer) {
        settingsContainer.insertAdjacentHTML('beforeend', settingsHtml);
    }

    document.getElementById('bulk-export-start')?.addEventListener('click', exportAllCharacters);
    document.getElementById('bulk-export-stop')?.addEventListener('click', stopExport);

    // 延迟更新角色数量
    setTimeout(updateTotalCount, 3000);

    console.log('[Bulk Character Exporter v2.0] 扩展已加载 - 支持分段导出');
});
