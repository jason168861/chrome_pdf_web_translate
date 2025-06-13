// content.js (v3.6 - 整合版，新增「解釋」功能)
// 版本說明：此腳本整合了針對 PDF 檢視器和通用網站的兩種不同邏輯。
// 它會自動偵測當前頁面網址，並執行對應的程式碼。

(function() {
    "use strict";

    // 1. 檢查當前網址，決定要執行哪一套邏輯
    const isPdfViewerPage = window.location.href.startsWith('https://jason168861.github.io/my-pdf-viewer/');

    if (isPdfViewerPage) {
        console.log("[Gemini 插件] 偵測到 PDF 檢視器頁面，正在載入 PDF 專用邏輯...");
        runPdfViewerLogic();
    } else {
        console.log("[Gemini 插件] 正在載入通用網站邏輯...");
        runGenericLogic();
    }


    // ===================================================================================
    // =================== 邏輯 A: 專為 https://jason168861.github.io/my-pdf-viewer/ 設計 ===================
    // ===================================================================================
    function runPdfViewerLogic() {
        // 請將此程式碼區塊貼在 runPdfViewerLogic() 和 runGenericLogic() 的開頭
(function injectKaTeXFontPaths() {
    // KaTeX 使用的主要字型列表
    const KATEX_FONTS = [
        "KaTeX_AMS-Regular", "KaTeX_Caligraphic-Bold", "KaTeX_Caligraphic-Regular",
        "KaTeX_Fraktur-Bold", "KaTeX_Fraktur-Regular", "KaTeX_Main-Bold",
        "KaTeX_Main-BoldItalic", "KaTeX_Main-Italic", "KaTeX_Main-Regular",
        "KaTeX_Math-BoldItalic", "KaTeX_Math-Italic", "KaTeX_SansSerif-Bold",
        "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Regular", "KaTeX_Script-Regular",
        "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular",
        "KaTeX_Size4-Regular", "KaTeX_Typewriter-Regular"
    ];
    
    // 定義字型格式
    const FONT_FORMATS = {
        "woff2": "woff2",
        "woff": "woff",
        "ttf": "truetype"
    };

    let css = '';
    
    // 遍歷所有字型和格式，產生 CSS 的 @font-face 規則
    for (const font of KATEX_FONTS) {
        let srcList = [];
        for (const format in FONT_FORMATS) {
            // 使用 chrome.runtime.getURL() 獲取擴充功能內檔案的絕對路徑
            const url = chrome.runtime.getURL(`fonts/${font}.${format}`);
            srcList.push(`url(${url}) format('${FONT_FORMATS[format]}')`);
        }
        
        css += `
            @font-face {
                font-family: '${font.split('-')[0]}';
                src: ${srcList.join(',\n' + ' '.repeat(17))};
                font-style: ${font.includes('Italic') ? 'italic' : 'normal'};
                font-weight: ${font.includes('Bold') ? 'bold' : 'normal'};
            }
        `;
    }

    // 建立一個 <style> 標籤並將產生的 CSS 注入到網頁的 <head> 中
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    (document.head || document.documentElement).appendChild(styleElement);
    console.log('[Gemini] KaTeX 字型路徑已動態注入。');
})();
        console.log("--- Gemini 翻譯/解釋插件 content.js v3.6 (PDF 專用版) 開始載入... ---");

        let isTranslatorEnabled = true;
        let activeInstances = {};
        let isUpdateLoopRunning = false;
        let isProcessingUITranslation = false;
        
        const pdfViewer = document.getElementById('pdf-viewer');

        // ✨ 修改：promoteTriggerToBox 函式現在需要知道是「翻譯」還是「解釋」
        function promoteTriggerToBox(instanceId, requestType = 'translate') {
            const instance = activeInstances[instanceId];
            if (!instance || instance.type !== 'trigger') return;

            instance.type = 'box';
            instance.isManuallyPositioned = false;
            instance.manualOffset = { top: 0, left: 0 };
            instance.isBeingDragged = false;
            instance.isAnchored = true;
            instance.lastAnchorRect = null;
            
            if (instance.trigger) instance.trigger.remove();
            instance.trigger = null;

            const box = document.createElement('div');
            box.className = 'gemini-translation-result-box gemini-ui-element';
            box.dataset.instanceId = instanceId;
            box.style.position = 'absolute';

            // ✨ 修改：根據要求類型顯示不同的標題和初始訊息
            const title = requestType === 'translate' ? 'Gemini 翻譯' : 'Gemini 解釋';
            const loadingMessage = requestType === 'translate' ? '正在翻譯中...' : '正在產生解釋...';

            box.innerHTML = `
                <div class="gemini-result-header">
                    <span>${title}</span>
                    <span class="gemini-close-btn">&times;</span>
                </div>
                <div class="gemini-result-content">${loadingMessage}</div>
                <div class="gemini-resize-handle"></div>`;
            document.body.appendChild(box);
            
            instance.box = box;

            makeResultBoxDraggable(box, box.querySelector('.gemini-result-header'), instanceId);
            makeBoxResizable(box, box.querySelector('.gemini-resize-handle'));
            box.querySelector('.gemini-close-btn').addEventListener('click', () => {
                cleanupInstance(instanceId);
            });

            // ✨ 修改：發送包含 requestType 的訊息給 background.js
            console.log(`[Gemini] 發送 ${requestType} 請求 (ID: ${instanceId})，內容為: "${instance.text}"`);
            chrome.runtime.sendMessage({ action: requestType, text: instance.text, instanceId: instanceId });

            instance.translationTimeout = setTimeout(() => {
                if (instance && instance.box) {
                    const contentDiv = instance.box.querySelector('.gemini-result-content');
                    if (contentDiv && contentDiv.innerText.includes('...')) {
                        contentDiv.innerText = `${title}超時或失敗。\n請檢查 background.js 的控制台是否有錯誤。`;
                        contentDiv.style.color = '#D32F2F';
                    }
                }
            }, 120000);
        }

        function makeResultBoxDraggable(element, handle, instanceId) {
            handle.onmousedown = (e) => {
                if (e.target.classList.contains('gemini-close-btn')) {
                    return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                const instance = activeInstances[instanceId];
                if (!instance) return;

                instance.isBeingDragged = true;

                let shiftX = e.clientX - element.getBoundingClientRect().left;
                let shiftY = e.clientY - element.getBoundingClientRect().top;

                // ✨ --- 修正開始 --- ✨
                // 1. 找到內容的 div
                const contentDiv = element.querySelector('.gemini-result-content');
                // 2. 在移動 DOM 前，記住當前的滾動位置
                const currentScrollTop = contentDiv.scrollTop;
                const currentScrollLeft = contentDiv.scrollLeft;
                // ✨ --- 修正結束 --- ✨

                document.body.append(element);
                element.style.position = 'absolute';
                
                // ✨ --- 修正開始 --- ✨
                // 3. 移動 DOM 後，立刻還原滾動位置
                contentDiv.scrollTop = currentScrollTop;
                contentDiv.scrollLeft = currentScrollLeft;
                // ✨ --- 修正結束 --- ✨
                
                function moveAt(pageX, pageY) {
                    element.style.left = `${pageX - shiftX}px`;
                    element.style.top = `${pageY - shiftY}px`;
                }
                moveAt(e.pageX, e.pageY);

                function onMouseMove(event) {
                    moveAt(event.pageX, event.pageY);
                }
                document.addEventListener('mousemove', onMouseMove);

                document.addEventListener('mouseup', function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    if (instance && instance.anchor) {
                        const finalBoxRect = element.getBoundingClientRect();
                        const anchorRect = instance.anchor.getBoundingClientRect();

                        const scrollX = window.scrollX;
                        const scrollY = window.scrollY;

                        instance.manualOffset.top = (finalBoxRect.top + scrollY) - (anchorRect.top + scrollY);
                        instance.manualOffset.left = (finalBoxRect.left + scrollX) - (anchorRect.left + scrollX);

                        instance.isManuallyPositioned = true;
                    }
                    
                    if (instance) {
                       instance.isBeingDragged = false;
                    }

                }, { once: true });
            };
            handle.ondragstart = () => false;
        }

        function makeBoxResizable(box, handle) {
            let startX, startY, startWidth, startHeight;

            handle.onmousedown = function(e) {
                e.preventDefault();
                e.stopPropagation();

                startX = e.clientX;
                startY = e.clientY;
                startWidth = parseInt(document.defaultView.getComputedStyle(box).width, 10);
                startHeight = parseInt(document.defaultView.getComputedStyle(box).height, 10);

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            function onMouseMove(e) {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                const newWidth = startWidth + deltaX;
                const newHeight = startHeight + deltaY;
                box.style.width = Math.max(newWidth, 250) + 'px';
                box.style.height = Math.max(newHeight, 100) + 'px';
            }

            function onMouseUp() {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        }

function masterUpdateLoop() {
    if (!isUpdateLoopRunning) return;

    const idsToDelete = [];

    for (const instanceId in activeInstances) {
        const instance = activeInstances[instanceId];

        if (instance.isBeingDragged) {
            continue;
        }
        
        const anchor = instance.anchor;
        if (!anchor || !document.body.contains(anchor)) {
            idsToDelete.push(instanceId);
            continue;
        }

        const elementToPosition = instance.type === 'trigger' ? instance.trigger : instance.box;
        if (!elementToPosition) continue;

        const anchorRect = anchor.getBoundingClientRect();
        
        const anchorAbsoluteTop = anchorRect.top + window.scrollY;
        const anchorAbsoluteLeft = anchorRect.left + window.scrollX;

        if (instance.isManuallyPositioned) {
            elementToPosition.style.top = `${anchorAbsoluteTop + instance.manualOffset.top}px`;
            elementToPosition.style.left = `${anchorAbsoluteLeft + instance.manualOffset.left}px`;
        } else {
                if (!instance.initialOffset) {
                    const selection = window.getSelection();
                    if (selection && !selection.isCollapsed) {
                        
                        // ✨ --- 這是核心修改：將觸發按鈕定位於選取文字的「末端」--- ✨
                        // 1. 複製當前的選取範圍
                        const endRange = selection.getRangeAt(0).cloneRange();
                        // 2. 將複製的範圍收起到其「結束點」(這是關鍵修改！)
                        endRange.collapse(false); // 將 true 改為 false
                        // 3. 取得這個「結束點」的座標方框
                        const endRect = endRange.getBoundingClientRect();
                        // ✨ --- 修改結束 --- ✨

                        instance.initialOffset = {
                            // 使用結束點的底部和左側來計算偏移
                            top: (endRect.bottom + window.scrollY) - anchorAbsoluteTop,
                            left: (endRect.left + window.scrollX) - anchorAbsoluteLeft
                        };
                    } else {
                        instance.initialOffset = { top: 20, left: 0 };
                    }
                }
            
            const yOffset = instance.type === 'trigger' ? 5 : 15;
            elementToPosition.style.top = `${anchorAbsoluteTop + instance.initialOffset.top + yOffset}px`;
            elementToPosition.style.left = `${anchorAbsoluteLeft + instance.initialOffset.left}px`;
        }
    }
    
    idsToDelete.forEach(id => cleanupInstance(id));

    requestAnimationFrame(masterUpdateLoop);
}

        function createTriggerInstance(selection) {
            const instanceId = `gemini-instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const range = selection.getRangeAt(0);

            const pageContainer = range.startContainer.parentElement.closest('.page-container');
            // if (!pageContainer) {
            //     console.warn("[Gemini] 選取範圍不在可識別的 .page-container 內，取消觸發。");
            //     return;
            // }

            const textToTranslate = selection.toString();
            
            // ✨ 新增：創建一個容器來放置兩個按鈕
            const triggerContainer = document.createElement('div');
            triggerContainer.className = 'gemini-selection-trigger-container gemini-ui-element';
            triggerContainer.dataset.instanceId = instanceId;
            triggerContainer.style.position = 'absolute';
            triggerContainer.style.display = 'flex'; // 讓按鈕並排
            triggerContainer.style.gap = '5px'; // 按鈕間距

            // 創建翻譯按鈕
            const translateButton = document.createElement('div');
            translateButton.className = 'gemini-selection-trigger';
            translateButton.innerText = '翻譯';

            // 創建解釋按鈕
            const explainButton = document.createElement('div');
            explainButton.className = 'gemini-selection-trigger';
            explainButton.innerText = '解釋';
            
            triggerContainer.appendChild(translateButton);
            triggerContainer.appendChild(explainButton);
            document.body.appendChild(triggerContainer);

            activeInstances[instanceId] = {
                id: instanceId,
                type: 'trigger',
                anchor: pageContainer, 
                trigger: triggerContainer, // ✨ 修改：現在 trigger 是指按鈕容器
                text: textToTranslate,
                initialOffset: null, 
                manualOffset: { top: 0, left: 0 },
                isManuallyPositioned: false
            };

            // ✨ 修改：為兩個按鈕分別添加事件監聽
            translateButton.addEventListener('mousedown', (e) => {
                e.preventDefault(); 
                e.stopPropagation();
                isProcessingUITranslation = true;
                promoteTriggerToBox(instanceId, 'translate'); // 傳遞 'translate'
            });

            explainButton.addEventListener('mousedown', (e) => {
                e.preventDefault(); 
                e.stopPropagation();
                isProcessingUITranslation = true;
                promoteTriggerToBox(instanceId, 'explain'); // 傳遞 'explain'
            });

            if (!isUpdateLoopRunning) {
                startMasterUpdateLoop();
            }
        }

        function cleanupInstance(instanceId) {
            const instance = activeInstances[instanceId];
            if (!instance) return;

            if (instance.translationTimeout) {
                clearTimeout(instance.translationTimeout);
            }

            if (instance.trigger) instance.trigger.remove();
            if (instance.box) instance.box.remove();

            delete activeInstances[instanceId];

            if (Object.keys(activeInstances).length === 0) {
                stopMasterUpdateLoop();
            }
        }
        
        function cleanupAllTriggers() {
            const idsToClean = [];
            for (const instanceId in activeInstances) {
                if (activeInstances[instanceId].type === 'trigger') {
                    idsToClean.push(instanceId);
                }
            }
            idsToClean.forEach(id => cleanupInstance(id));
        }
        
        function startMasterUpdateLoop() {
            if (isUpdateLoopRunning) return;
            isUpdateLoopRunning = true;
            masterUpdateLoop();
        }

        function stopMasterUpdateLoop() {
            isUpdateLoopRunning = false;
        }
        
        function main() {
            initializeTranslatorFeatures();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }

chrome.runtime.onMessage.addListener((request, sender) => {
    if ((request.action === 'translationResult' || request.action === 'explanationResult') && request.instanceId) {
        const instance = activeInstances[request.instanceId];
        if (instance && instance.type === 'box' && instance.box) {
            if (instance.translationTimeout) {
                clearTimeout(instance.translationTimeout);
            }

            const contentDiv = instance.box.querySelector('.gemini-result-content');

            // ✨ --- 解決 Markdown 與 LaTeX 語法衝突的核心修改 --- ✨

            /**
             * 保護數學公式，防止被 marked.js 誤解析。
             * @param {string} text - 從 Gemini 收到的原始文字
             * @returns {string} - 保護好數學公式後的文字
             */
            function protectMath(text) {
                return text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match, blockContent, inlineContent) => {
                    const content = blockContent || inlineContent;
                    
                    // ✨ --- 這是唯一的修改處 --- ✨
                    // 在鏈式呼叫中，新增 .replace(/\*/g, '\\*') 來保護星號
                    const escapedContent = content.replace(/_/g, '\\_')
                                                  .replace(/\^/g, '\\^')
                                                  .replace(/\*/g, '\\*');
                    
                    if (blockContent) {
                        return `$$${escapedContent}$$`;
                    } else {
                        return `$${escapedContent}$`;
                    }
                });
            }

            // 步驟 1: 先用我們的保護函式處理原始文字
            const protectedText = protectMath(request.text);
            console.log(`[Gemini] 收到 ${request.action === 'translationResult' ? '翻譯' : '解釋'}結果 (ID: ${request.instanceId})，內容為: "${protectedText}"`);
            
            // 步驟 2: 再將保護後的文字交給 marked.js 解析
            let htmlContent;
            if (window.marked) {
                try {
                    htmlContent = window.marked.parse(protectedText);
                } catch (e) {
                    console.error('[Gemini] marked.js 解析時發生錯誤:', e);
                    htmlContent = protectedText;
                }
            } else {
                console.error('[Gemini] marked.js 函式庫未載入！');
                htmlContent = protectedText.replace(/\n/g, '<br>');
            }
            console.log('[Gemini] 解析後的 HTML 內容:', htmlContent);
            // 步驟 3: 將 HTML 內容寫入結果框
            contentDiv.innerHTML = htmlContent;

            // 步驟 4: 最後，呼叫 KaTeX 渲染所有數學公式 (它能正確處理我們之前加入的轉義字元)
            if (window.renderMathInElement) {
                try {
                    renderMathInElement(contentDiv, {
                        delimiters: [
                            {left: "$$", right: "$$", display: true},
                            {left: "$", right: "$", display: false}
                        ],
                        throwOnError: false
                    });
                    console.log('[Gemini] KaTeX 渲染完成。');
                } catch (e) {
                    console.error('[Gemini] KaTeX 渲染時發生錯誤:', e);
                }
            } else {
                console.error('[Gemini] KaTeX 的 renderMathInElement 函式未找到！');
            }

            // ✨ --- 修改結束 --- ✨

            contentDiv.style.color = '';
        }
    }
});

        function updateFabState() {
            const fab = document.getElementById('gemini-fab');
            if (fab) {
                fab.style.backgroundColor = isTranslatorEnabled ? '#4285F4' : '#757575';
            }
        }

        chrome.storage.sync.get('isTranslatorEnabled', (data) => {
            isTranslatorEnabled = data.isTranslatorEnabled !== false;
            updateFabState();
        });

        chrome.storage.onChanged.addListener((changes) => {
            if (changes.isTranslatorEnabled) {
                isTranslatorEnabled = changes.isTranslatorEnabled.newValue;
                updateFabState();
                if (!isTranslatorEnabled) {
                    cleanupAllTriggers();
                    Object.keys(activeInstances).forEach(cleanupInstance);
                }
            }
        });

        function initializeTranslatorFeatures() {
            if (document.getElementById('gemini-fab')) return;
            createFabAndMenu();
            setupGlobalListeners();
            updateFabState();
        }

        function createFabAndMenu() {
            const fab = document.createElement('div');
            fab.id = 'gemini-fab';
            fab.innerText = 'G';
            document.body.appendChild(fab);
            const fabMenu = document.createElement('div');
            fabMenu.id = 'gemini-fab-menu';
            // ✨ 修改：更新選單文字，使其更通用
            fabMenu.innerHTML = `<div class="gemini-menu-item"><span>啟用 Gemini 功能</span><label class="gemini-switch"><input type="checkbox" id="gemini-enable-switch" ${isTranslatorEnabled ? 'checked' : ''}><span class="gemini-slider"></span></label></div>`;
            document.body.appendChild(fabMenu);
        }

        function setupGlobalListeners() {
            document.addEventListener('mouseup', (e) => {
                if (!isTranslatorEnabled) return;
                const clickedOnOurUI = e.target.closest('.gemini-ui-element, #gemini-fab, #gemini-fab-menu');
                if (!clickedOnOurUI) {
                    cleanupAllTriggers();
                }
                setTimeout(() => {
                    if (isProcessingUITranslation) {
                        isProcessingUITranslation = false;
                        return;
                    }
                    const potentiallyNewClickedOnUI = e.target.closest('.gemini-ui-element');
                    if(potentiallyNewClickedOnUI) return;
                    const selection = window.getSelection();
                    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                        return;
                    }
                    const selectedText = selection.toString().trim();
                    if (selectedText.length > 0) {
                        if(!clickedOnOurUI) cleanupAllTriggers();
                        createTriggerInstance(selection);
                    }
                }, 50);
            });

            document.addEventListener('click', (e) => {
                const fab = document.getElementById('gemini-fab');
                const fabMenu = document.getElementById('gemini-fab-menu');
                if (fab && fab.contains(e.target)) {
                    e.stopPropagation();
                    fabMenu.classList.toggle('visible');
                } else if (fabMenu && !fabMenu.contains(e.target)) {
                    fabMenu.classList.remove('visible');
                }
                const enableSwitch = document.getElementById('gemini-enable-switch');
                if (enableSwitch && e.target === enableSwitch) {
                    chrome.storage.sync.set({ isTranslatorEnabled: e.target.checked });
                }
            });
        }
    }


    // ===================================================================================
    // ============================= 邏輯 B: 用於所有其他通用網站 =============================
    // ===================================================================================
    function runGenericLogic() {
        // 請將此程式碼區塊貼在 runPdfViewerLogic() 和 runGenericLogic() 的開頭
(function injectKaTeXFontPaths() {
    // KaTeX 使用的主要字型列表
    const KATEX_FONTS = [
        "KaTeX_AMS-Regular", "KaTeX_Caligraphic-Bold", "KaTeX_Caligraphic-Regular",
        "KaTeX_Fraktur-Bold", "KaTeX_Fraktur-Regular", "KaTeX_Main-Bold",
        "KaTeX_Main-BoldItalic", "KaTeX_Main-Italic", "KaTeX_Main-Regular",
        "KaTeX_Math-BoldItalic", "KaTeX_Math-Italic", "KaTeX_SansSerif-Bold",
        "KaTeX_SansSerif-Italic", "KaTeX_SansSerif-Regular", "KaTeX_Script-Regular",
        "KaTeX_Size1-Regular", "KaTeX_Size2-Regular", "KaTeX_Size3-Regular",
        "KaTeX_Size4-Regular", "KaTeX_Typewriter-Regular"
    ];
    
    // 定義字型格式
    const FONT_FORMATS = {
        "woff2": "woff2",
        "woff": "woff",
        "ttf": "truetype"
    };

    let css = '';
    
    // 遍歷所有字型和格式，產生 CSS 的 @font-face 規則
    for (const font of KATEX_FONTS) {
        let srcList = [];
        for (const format in FONT_FORMATS) {
            // 使用 chrome.runtime.getURL() 獲取擴充功能內檔案的絕對路徑
            const url = chrome.runtime.getURL(`fonts/${font}.${format}`);
            srcList.push(`url(${url}) format('${FONT_FORMATS[format]}')`);
        }
        
        css += `
            @font-face {
                font-family: '${font.split('-')[0]}';
                src: ${srcList.join(',\n' + ' '.repeat(17))};
                font-style: ${font.includes('Italic') ? 'italic' : 'normal'};
                font-weight: ${font.includes('Bold') ? 'bold' : 'normal'};
            }
        `;
    }

    // 建立一個 <style> 標籤並將產生的 CSS 注入到網頁的 <head> 中
    const styleElement = document.createElement('style');
    styleElement.textContent = css;
    (document.head || document.documentElement).appendChild(styleElement);
    console.log('[Gemini] KaTeX 字型路徑已動態注入。');
})();
        console.log("--- Gemini 翻譯/解釋插件 content.js v3.6 (通用版) 開始載入... ---");

        let isTranslatorEnabled = true;
        let activeInstances = {};
        let isUpdateLoopRunning = false;
        let isProcessingUITranslation = false;
        
        // ✨ 修改：promoteTriggerToBox 函式現在需要知道是「翻譯」還是「解釋」
        function promoteTriggerToBox(instanceId, requestType = 'translate') {
            const instance = activeInstances[instanceId];
            if (!instance || instance.type !== 'trigger') return;

            instance.type = 'box';
            instance.isManuallyPositioned = false;
            instance.manualOffset = { top: 0, left: 0 };
            instance.isBeingDragged = false;
            instance.isAnchored = true;
            instance.lastAnchorRect = null;
            
            if (instance.trigger) instance.trigger.remove();
            instance.trigger = null;

            const box = document.createElement('div');
            box.className = 'gemini-translation-result-box gemini-ui-element';
            box.dataset.instanceId = instanceId;
            box.style.position = 'absolute';

            // ✨ 修改：根據要求類型顯示不同的標題和初始訊息
            const title = requestType === 'translate' ? 'Gemini 翻譯' : 'Gemini 解釋';
            const loadingMessage = requestType === 'translate' ? '正在翻譯中...' : '正在產生解釋...';
            
            box.innerHTML = `
                <div class="gemini-result-header">
                    <span>${title}</span>
                    <span class="gemini-close-btn">&times;</span>
                </div>
                <div class="gemini-result-content">${loadingMessage}</div>
                <div class="gemini-resize-handle"></div>`;
            document.body.appendChild(box);
            
            instance.box = box;

            makeResultBoxDraggable(box, box.querySelector('.gemini-result-header'), instanceId);
            makeBoxResizable(box, box.querySelector('.gemini-resize-handle'));
            box.querySelector('.gemini-close-btn').addEventListener('click', () => {
                cleanupInstance(instanceId);
            });

            // ✨ 修改：發送包含 requestType 的訊息給 background.js
            console.log(`[Gemini] 發送 ${requestType} 請求 (ID: ${instanceId})，內容為: "${instance.text}"`);
            chrome.runtime.sendMessage({ action: requestType, text: instance.text, instanceId: instanceId });

            instance.translationTimeout = setTimeout(() => {
                if (instance && instance.box) {
                    const contentDiv = instance.box.querySelector('.gemini-result-content');
                     if (contentDiv && contentDiv.innerText.includes('...')) {
                        contentDiv.innerText = `${title}超時或失敗。\n請檢查 background.js 的控制台是否有錯誤。`;
                        contentDiv.style.color = '#D32F2F';
                    }
                }
            }, 120000);
        }

        function makeResultBoxDraggable(element, handle, instanceId) {
            handle.onmousedown = (e) => {
                if (e.target.classList.contains('gemini-close-btn')) {
                    return;
                }
                
                e.preventDefault();
                e.stopPropagation();
                
                const instance = activeInstances[instanceId];
                if (!instance) return;

                instance.isBeingDragged = true;

                let shiftX = e.clientX - element.getBoundingClientRect().left;
                let shiftY = e.clientY - element.getBoundingClientRect().top;

                // ✨ --- 修正開始 --- ✨
                // 1. 找到內容的 div
                const contentDiv = element.querySelector('.gemini-result-content');
                // 2. 在移動 DOM 前，記住當前的滾動位置
                const currentScrollTop = contentDiv.scrollTop;
                const currentScrollLeft = contentDiv.scrollLeft;
                // ✨ --- 修正結束 --- ✨

                document.body.append(element);
                element.style.position = 'absolute';
                
                // ✨ --- 修正開始 --- ✨
                // 3. 移動 DOM 後，立刻還原滾動位置
                contentDiv.scrollTop = currentScrollTop;
                contentDiv.scrollLeft = currentScrollLeft;
                // ✨ --- 修正結束 --- ✨
                
                function moveAt(pageX, pageY) {
                    element.style.left = `${pageX - shiftX}px`;
                    element.style.top = `${pageY - shiftY}px`;
                }
                moveAt(e.pageX, e.pageY);

                function onMouseMove(event) {
                    moveAt(event.pageX, event.pageY);
                }
                document.addEventListener('mousemove', onMouseMove);

                document.addEventListener('mouseup', function onMouseUp() {
                    document.removeEventListener('mousemove', onMouseMove);
                    document.removeEventListener('mouseup', onMouseUp);

                    if (instance && instance.anchor) {
                        const finalBoxRect = element.getBoundingClientRect();
                        const anchorRect = instance.anchor.getBoundingClientRect();
                        
                        instance.manualOffset.top = finalBoxRect.top - anchorRect.bottom;
                        instance.manualOffset.left = finalBoxRect.left - anchorRect.left;
                        instance.isManuallyPositioned = true;
                    }
                    
                    if (instance) {
                       instance.isBeingDragged = false;
                    }

                }, { once: true });
            };
            handle.ondragstart = () => false;
        }

        function makeBoxResizable(box, handle) {
            let startX, startY, startWidth, startHeight;

            handle.onmousedown = function(e) {
                e.preventDefault();
                e.stopPropagation();

                startX = e.clientX;
                startY = e.clientY;
                startWidth = parseInt(document.defaultView.getComputedStyle(box).width, 10);
                startHeight = parseInt(document.defaultView.getComputedStyle(box).height, 10);

                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            };

            function onMouseMove(e) {
                const deltaX = e.clientX - startX;
                const deltaY = e.clientY - startY;
                const newWidth = startWidth + deltaX;
                const newHeight = startHeight + deltaY;
                box.style.width = Math.max(newWidth, 250) + 'px';
                box.style.height = Math.max(newHeight, 100) + 'px';
            }

            function onMouseUp() {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
            }
        }

        function masterUpdateLoop() {
            if (!isUpdateLoopRunning) return;

            const idsToDelete = [];

            for (const instanceId in activeInstances) {
                const instance = activeInstances[instanceId];

                if (instance.isBeingDragged) {
                    continue;
                }
                
                const anchor = instance.anchor;
                if (!anchor || !document.body.contains(anchor)) {
                    idsToDelete.push(instanceId);
                    continue;
                }

                const anchorRect = anchor.getBoundingClientRect();
                const scrollX = window.scrollX;
                const scrollY = window.scrollY;
                
                const elementToPosition = instance.type === 'trigger' ? instance.trigger : instance.box;
                if (elementToPosition) {
                    if (instance.isManuallyPositioned) {
                        elementToPosition.style.top = `${anchorRect.bottom + scrollY + instance.manualOffset.top}px`;
                        elementToPosition.style.left = `${anchorRect.left + scrollX + instance.manualOffset.left}px`;
                    } else {
                        const yOffset = instance.type === 'trigger' ? 5 : 15;
                        elementToPosition.style.top = `${anchorRect.bottom + scrollY + yOffset}px`;
                        elementToPosition.style.left = `${anchorRect.left + scrollX}px`;
                    }
                }
            }
            
            idsToDelete.forEach(id => cleanupInstance(id));

            requestAnimationFrame(masterUpdateLoop);
        }

        function createTriggerInstance(selection) {
            const instanceId = `gemini-instance-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const range = selection.getRangeAt(0);
            const textToTranslate = selection.toString();
            
            const endRange = range.cloneRange();
            endRange.collapse(false);
            const anchor = document.createElement('gemini-anchor');
            anchor.dataset.instanceId = instanceId;
            endRange.insertNode(anchor);
            
            // ✨ 新增：創建一個容器來放置兩個按鈕
            const triggerContainer = document.createElement('div');
            triggerContainer.className = 'gemini-selection-trigger-container gemini-ui-element';
            triggerContainer.dataset.instanceId = instanceId;
            triggerContainer.style.position = 'absolute';
            triggerContainer.style.display = 'flex'; // 讓按鈕並排
            triggerContainer.style.gap = '5px'; // 按鈕間距

            // 創建翻譯按鈕
            const translateButton = document.createElement('div');
            translateButton.className = 'gemini-selection-trigger';
            translateButton.innerText = '翻譯';

            // 創建解釋按鈕
            const explainButton = document.createElement('div');
            explainButton.className = 'gemini-selection-trigger';
            explainButton.innerText = '解釋';
            
            triggerContainer.appendChild(translateButton);
            triggerContainer.appendChild(explainButton);
            document.body.appendChild(triggerContainer);
            
            activeInstances[instanceId] = {
                id: instanceId,
                type: 'trigger',
                anchor: anchor,
                trigger: triggerContainer, // ✨ 修改：現在 trigger 是指按鈕容器
                text: textToTranslate
            };
            
            // ✨ 修改：為兩個按鈕分別添加事件監聽
            translateButton.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                isProcessingUITranslation = true;
                promoteTriggerToBox(instanceId, 'translate');
            });

            explainButton.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                isProcessingUITranslation = true;
                promoteTriggerToBox(instanceId, 'explain');
            });

            if (!isUpdateLoopRunning) {
                startMasterUpdateLoop();
            }
        }
        
        function cleanupInstance(instanceId) {
            const instance = activeInstances[instanceId];
            if (!instance) return;

            if (instance.translationTimeout) {
                clearTimeout(instance.translationTimeout);
            }

            if (instance.anchor) instance.anchor.remove();
            if (instance.trigger) instance.trigger.remove();
            if (instance.box) instance.box.remove();

            delete activeInstances[instanceId];

            if (Object.keys(activeInstances).length === 0) {
                stopMasterUpdateLoop();
            }
        }
        
        function cleanupAllTriggers() {
            const idsToClean = [];
            for (const instanceId in activeInstances) {
                if (activeInstances[instanceId].type === 'trigger') {
                    idsToClean.push(instanceId);
                }
            }
            idsToClean.forEach(id => cleanupInstance(id));
        }
        
        function startMasterUpdateLoop() {
            if (isUpdateLoopRunning) return;
            isUpdateLoopRunning = true;
            masterUpdateLoop();
        }

        function stopMasterUpdateLoop() {
            isUpdateLoopRunning = false;
        }
        
        function main() {
            initializeTranslatorFeatures();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }

chrome.runtime.onMessage.addListener((request, sender) => {
    if ((request.action === 'translationResult' || request.action === 'explanationResult') && request.instanceId) {
        const instance = activeInstances[request.instanceId];
        if (instance && instance.type === 'box' && instance.box) {
            if (instance.translationTimeout) {
                clearTimeout(instance.translationTimeout);
            }

            const contentDiv = instance.box.querySelector('.gemini-result-content');

            // ✨ --- 解決 Markdown 與 LaTeX 語法衝突的核心修改 --- ✨

            /**
             * 保護數學公式，防止被 marked.js 誤解析。
             * @param {string} text - 從 Gemini 收到的原始文字
             * @returns {string} - 保護好數學公式後的文字
             */
            function protectMath(text) {
                return text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match, blockContent, inlineContent) => {
                    const content = blockContent || inlineContent;
                    
                    // ✨ --- 這是唯一的修改處 --- ✨
                    // 在鏈式呼叫中，新增 .replace(/\*/g, '\\*') 來保護星號
                    const escapedContent = content.replace(/_/g, '\\_')
                                                  .replace(/\^/g, '\\^')
                                                  .replace(/\*/g, '\\*');
                    
                    if (blockContent) {
                        return `$$${escapedContent}$$`;
                    } else {
                        return `$${escapedContent}$`;
                    }
                });
            }
            // 步驟 1: 先用我們的保護函式處理原始文字
            const protectedText = protectMath(request.text);
            
            // 步驟 2: 再將保護後的文字交給 marked.js 解析
            let htmlContent;
            if (window.marked) {
                try {
                    htmlContent = window.marked.parse(protectedText);
                } catch (e) {
                    console.error('[Gemini] marked.js 解析時發生錯誤:', e);
                    htmlContent = protectedText;
                }
            } else {
                console.error('[Gemini] marked.js 函式庫未載入！');
                htmlContent = protectedText.replace(/\n/g, '<br>');
            }
            
            // 步驟 3: 將 HTML 內容寫入結果框
            contentDiv.innerHTML = htmlContent;

            // 步驟 4: 最後，呼叫 KaTeX 渲染所有數學公式 (它能正確處理我們之前加入的轉義字元)
            if (window.renderMathInElement) {
                try {
                    renderMathInElement(contentDiv, {
                        delimiters: [
                            {left: "$$", right: "$$", display: true},
                            {left: "$", right: "$", display: false}
                        ],
                        throwOnError: false
                    });
                    console.log('[Gemini] KaTeX 渲染完成。');
                } catch (e) {
                    console.error('[Gemini] KaTeX 渲染時發生錯誤:', e);
                }
            } else {
                console.error('[Gemini] KaTeX 的 renderMathInElement 函式未找到！');
            }

            // ✨ --- 修改結束 --- ✨

            contentDiv.style.color = '';
        }
    }
});
        function updateFabState() {
            const fab = document.getElementById('gemini-fab');
            if (fab) {
                fab.style.backgroundColor = isTranslatorEnabled ? '#4285F4' : '#757575';
            }
        }

        chrome.storage.sync.get('isTranslatorEnabled', (data) => {
            isTranslatorEnabled = data.isTranslatorEnabled !== false;
            updateFabState();
        });

        chrome.storage.onChanged.addListener((changes) => {
            if (changes.isTranslatorEnabled) {
                isTranslatorEnabled = changes.isTranslatorEnabled.newValue;
                updateFabState();
                 if (!isTranslatorEnabled) {
                    cleanupAllTriggers();
                    Object.keys(activeInstances).forEach(cleanupInstance);
                }
            }
        });

        function initializeTranslatorFeatures() {
            if (document.getElementById('gemini-fab')) return;
            createFabAndMenu();
            setupGlobalListeners();
            updateFabState();
        }

        function createFabAndMenu() {
            const fab = document.createElement('div');
            fab.id = 'gemini-fab';
            fab.innerText = 'G';
            document.body.appendChild(fab);
            const fabMenu = document.createElement('div');
            fabMenu.id = 'gemini-fab-menu';

            // ✨ 修改：更新選單文字，使其更通用
            const isEnabled = isTranslatorEnabled ? 'checked' : '';
            fabMenu.innerHTML = `
                <div class="gemini-menu-item gemini-pdf-link-item">
                    <a href="https://jason168861.github.io/my-pdf-viewer/" target="_blank" rel="noopener noreferrer">
                        翻譯 PDF 文件
                    </a>
                    <small>瀏覽器預設的 PDF 檢視器不支援，請由此上傳檔案操作。</small>
                </div>
                <div class="gemini-menu-separator"></div>
                <div class="gemini-menu-item">
                    <span>啟用 Gemini 功能</span>
                    <label class="gemini-switch">
                        <input type="checkbox" id="gemini-enable-switch" ${isEnabled}>
                        <span class="gemini-slider"></span>
                    </label>
                </div>
            `;
            document.body.appendChild(fabMenu);
        }

        function setupGlobalListeners() {
            document.addEventListener('mouseup', (e) => {
                if (!isTranslatorEnabled) return;
                const clickedOnOurUI = e.target.closest('.gemini-ui-element, #gemini-fab, #gemini-fab-menu');
                if (!clickedOnOurUI) {
                    cleanupAllTriggers();
                }
                setTimeout(() => {
                    if (isProcessingUITranslation) {
                        isProcessingUITranslation = false;
                        return;
                    }
                    const potentiallyNewClickedOnUI = e.target.closest('.gemini-ui-element');
                    if(potentiallyNewClickedOnUI) return;
                    const selection = window.getSelection();
                    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                        return;
                    }
                    const selectedText = selection.toString().trim();
                    if (selectedText.length > 0) {
                        if(!clickedOnOurUI) cleanupAllTriggers();
                        createTriggerInstance(selection);
                    }
                }, 50);
            });

            document.addEventListener('click', (e) => {
                const fab = document.getElementById('gemini-fab');
                const fabMenu = document.getElementById('gemini-fab-menu');
                if (fab && fab.contains(e.target)) {
                    e.stopPropagation();
                    fabMenu.classList.toggle('visible');
                } else if (fabMenu && !fabMenu.contains(e.target)) {
                    fabMenu.classList.remove('visible');
                }
                const enableSwitch = document.getElementById('gemini-enable-switch');
                if (enableSwitch && e.target === enableSwitch) {
                    chrome.storage.sync.set({ isTranslatorEnabled: e.target.checked });
                }
            });
        }
    }

})();