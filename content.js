// content.js (v3.8 - 整合版，為 PDF 和通用頁面新增聊天功能)
// 版本說明：此腳本整合了針對 PDF 檢視器和通用網站的兩種不同邏輯。
// 新增的聊天室功能已分別適配兩種邏輯，以確保原有功能穩定。

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
        (function injectKaTeXFontPaths() {
            const KATEX_FONTS=["KaTeX_AMS-Regular","KaTeX_Caligraphic-Bold","KaTeX_Caligraphic-Regular","KaTeX_Fraktur-Bold","KaTeX_Fraktur-Regular","KaTeX_Main-Bold","KaTeX_Main-BoldItalic","KaTeX_Main-Italic","KaTeX_Main-Regular","KaTeX_Math-BoldItalic","KaTeX_Math-Italic","KaTeX_SansSerif-Bold","KaTeX_SansSerif-Italic","KaTeX_SansSerif-Regular","KaTeX_Script-Regular","KaTeX_Size1-Regular","KaTeX_Size2-Regular","KaTeX_Size3-Regular","KaTeX_Size4-Regular","KaTeX_Typewriter-Regular"];
            const FONT_FORMATS={"woff2":"woff2","woff":"woff","ttf":"truetype"};
            let css='';
            for(const font of KATEX_FONTS){
                let srcList=[];
                for(const format in FONT_FORMATS){
                    const url=chrome.runtime.getURL(`fonts/${font}.${format}`);
                    srcList.push(`url(${url}) format('${FONT_FORMATS[format]}')`);
                }
                css+=`
                    @font-face {
                        font-family: '${font.split('-')[0]}';
                        src: ${srcList.join(',\n' + ' '.repeat(17))};
                        font-style: ${font.includes('Italic')?'italic':'normal'};
                        font-weight: ${font.includes('Bold')?'bold':'normal'};
                    }
                `;
            }
            const styleElement=document.createElement('style');
            styleElement.textContent=css;
            (document.head || document.documentElement).appendChild(styleElement);
            console.log('[Gemini] KaTeX 字型路徑已動態注入。');
        })();
        console.log("--- Gemini 翻譯/解釋/聊天插件 content.js v3.8 (PDF 專用版) 開始載入... ---");

        let isTranslatorEnabled = true;
        let activeInstances = {};
        let isUpdateLoopRunning = false;
        let isProcessingUITranslation = false;
        let chatImageCache = null; // ✨ NEW: 聊天相關的狀態變數
        const pdfViewer = document.getElementById('pdf-viewer');

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

                const contentDiv = element.querySelector('.gemini-result-content');
                const currentScrollTop = contentDiv.scrollTop;
                const currentScrollLeft = contentDiv.scrollLeft;

                document.body.append(element);
                element.style.position = 'absolute';
                
                contentDiv.scrollTop = currentScrollTop;
                contentDiv.scrollLeft = currentScrollLeft;
                
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
                                
                                const endRange = selection.getRangeAt(0).cloneRange();
                                endRange.collapse(false);
                                const endRect = endRange.getBoundingClientRect();

                                instance.initialOffset = {
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
            if (!pageContainer) {
                console.warn("[Gemini] 選取範圍不在可識別的 .page-container 內，取消觸發。");
                return;
            }

            const textToTranslate = selection.toString();
            
            const triggerContainer = document.createElement('div');
            triggerContainer.className = 'gemini-selection-trigger-container gemini-ui-element';
            triggerContainer.dataset.instanceId = instanceId;
            triggerContainer.style.position = 'absolute';

            const translateButton = document.createElement('div');
            translateButton.className = 'gemini-selection-trigger';
            translateButton.innerText = '翻譯';

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
                trigger: triggerContainer,
                text: textToTranslate,
                initialOffset: null, 
                manualOffset: { top: 0, left: 0 },
                isManuallyPositioned: false
            };

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

        // ✨ MODIFIED: onMessage listener 現在要處理更多種回覆
        chrome.runtime.onMessage.addListener((request, sender) => {
            if ((request.action === 'translationResult' || request.action === 'explanationResult') && request.instanceId) {
                const instance = activeInstances[request.instanceId];
                if (instance && instance.type === 'box' && instance.box) {
                    if (instance.translationTimeout) clearTimeout(instance.translationTimeout);
                    const contentDiv = instance.box.querySelector('.gemini-result-content');
                    if (request.isError) {
                        contentDiv.innerHTML = `<span style="color: red;">${request.text}</span>`;
                        return;
                    }
                    renderMarkdownAndMath(contentDiv, request.text);
                }
                return;
            }
            if (request.action === 'chatResult') {
                removeChatLoading();
                if (request.isError) {
                    addMessageToChat('system', request.text);
                } else {
                    addMessageToChat('model', request.text);
                }
                return;
            }
            if (request.action === 'historyCleared') {
                const messagesDiv = document.getElementById('gemini-chat-messages');
                if(messagesDiv) messagesDiv.innerHTML = '';
                addMessageToChat('system', request.text);
                return;
            }
        });

        // ✨ NEW: 渲染 Markdown 和數學公式的通用函式
        function renderMarkdownAndMath(element, text) {
            function protectMath(text) {
                return text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match, blockContent, inlineContent) => {
                    const content = blockContent || inlineContent;
                    const escapedContent = content.replace(/_/g, '\\_').replace(/\^/g, '\\^').replace(/\*/g, '\\*');
                    return blockContent ? `$$${escapedContent}$$` : `$${escapedContent}$`;
                });
            }
            const protectedText = protectMath(text);
            let htmlContent;
            if (window.marked) {
                try { htmlContent = window.marked.parse(protectedText); } catch (e) {
                    console.error('[Gemini] marked.js 解析時發生錯誤:', e);
                    htmlContent = protectedText.replace(/\n/g, '<br>');
                }
            } else {
                console.error('[Gemini] marked.js 函式庫未載入！');
                htmlContent = protectedText.replace(/\n/g, '<br>');
            }
            element.innerHTML = htmlContent;
            if (window.renderMathInElement) {
                try {
                    renderMathInElement(element, {
                        delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}],
                        throwOnError: false
                    });
                } catch (e) { console.error('[Gemini] KaTeX 渲染時發生錯誤:', e); }
            } else { console.error('[Gemini] KaTeX 的 renderMathInElement 函式未找到！'); }
        }

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
                    const fabMenu = document.getElementById('gemini-fab-menu');
                    if(fabMenu) fabMenu.classList.remove('visible');
                }
            }
        });

        function initializeTranslatorFeatures() {
            if (document.getElementById('gemini-fab')) return;
            createFabAndMenu();
            setupGlobalListeners();
            updateFabState();
        }

        // ✨ MODIFIED: 大幅修改，建立主選單和聊天介面
        function createFabAndMenu() {
            const fab = document.createElement('div');
            fab.id = 'gemini-fab';
            fab.innerText = 'G';
            document.body.appendChild(fab);

            const fabMenu = document.createElement('div');
            fabMenu.id = 'gemini-fab-menu';
            fabMenu.classList.add('gemini-ui-element');

            const isEnabled = isTranslatorEnabled ? 'checked' : '';

            // 主選單介面 (PDF 版沒有 PDF 連結)
            const mainMenuHTML = `
                <div id="gemini-menu-main" style="width: 100%;">
                    <div class="gemini-menu-item" id="gemini-open-chat-btn">
                        <span>💬 開啟 Gemini 聊天室</span>
                    </div>
                    <div class="gemini-menu-separator"></div>
                    <div class="gemini-menu-item">
                        <span>啟用 Gemini 功能</span>
                        <label class="gemini-switch">
                            <input type="checkbox" id="gemini-enable-switch" ${isEnabled}>
                            <span class="gemini-slider"></span>
                        </label>
                    </div>
                </div>
            `;

            const chatViewHTML = `
                <div id="gemini-chat-view" style="display: none;">
                    <div id="gemini-chat-header">
                        <button id="gemini-chat-back-btn" title="返回主選單">‹</button>
                        <span id="gemini-chat-title">Gemini 聊天室</span>
                        <button id="gemini-chat-clear-btn" title="清除聊天記錄">🗑️</button>
                    </div>
                    <div id="gemini-chat-messages"></div>
                    <div id="gemini-chat-input-container">
                         <div id="gemini-chat-file-preview" style="display: none;"></div>
                         <form id="gemini-chat-input-form">
                             <label for="gemini-chat-file-input" id="gemini-chat-file-label" title="上傳圖片/檔案">
                                 <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"></path></svg>
                             </label>
                             <input type="file" id="gemini-chat-file-input" accept="image/jpeg,image/png,image/webp,image/heic">
                             <textarea id="gemini-chat-textarea" rows="1" placeholder="輸入訊息..."></textarea>
                             <button type="submit" id="gemini-chat-send-btn" title="傳送">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                             </button>
                         </form>
                    </div>
                </div>
            `;

            fabMenu.innerHTML = mainMenuHTML + chatViewHTML;
            document.body.appendChild(fabMenu);
            setupChatListeners();
        }
        // ✨ NEW: 處理圖片檔案的邏輯被抽成一個可重複使用的函式
        function handleImageFile(file) {
            // 確保傳入的是一個圖片檔案
            if (!file || !file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                chatImageCache = event.target.result;
                const filePreview = document.getElementById('gemini-chat-file-preview');
                
                // 建立預覽畫面和移除按鈕
                filePreview.innerHTML = `<img src="${chatImageCache}" alt="Preview"><button id="gemini-chat-remove-file">&times;</button>`;
                filePreview.style.display = 'block';

                // 為移除按鈕加上事件監聽
                document.getElementById('gemini-chat-remove-file').addEventListener('click', () => {
                    filePreview.style.display = 'none';
                    filePreview.innerHTML = '';
                    chatImageCache = null;
                    // 重設 input 的值，這樣才能再次選擇同一個檔案
                    document.getElementById('gemini-chat-file-input').value = ''; 
                });
            };
            // 讀取檔案並轉為 Base64
            reader.readAsDataURL(file);
        }
// ✨ MODIFIED: 此函式已更新，以整合貼上圖片功能
function setupChatListeners() {
    const mainMenu = document.getElementById('gemini-menu-main');
    const chatView = document.getElementById('gemini-chat-view');
    const fileInput = document.getElementById('gemini-chat-file-input');
    const textarea = document.getElementById('gemini-chat-textarea');
    const form = document.getElementById('gemini-chat-input-form');

    // --- 按鈕切換邏輯 (維持不變) ---
    document.getElementById('gemini-open-chat-btn').addEventListener('click', () => {
        mainMenu.style.display = 'none';
        chatView.style.display = 'flex';
        if (document.getElementById('gemini-chat-messages').childElementCount === 0) {
            addMessageToChat('system', '你好！我可以為你做什麼？');
        }
    });
    document.getElementById('gemini-chat-back-btn').addEventListener('click', () => {
        chatView.style.display = 'none';
        mainMenu.style.display = 'block';
    });
    document.getElementById('gemini-chat-clear-btn').addEventListener('click', () => {
        if(confirm('確定要清除本次的所有聊天記錄嗎？')) {
            chrome.runtime.sendMessage({ action: 'clearChatHistory' });
        }
    });

    // ✨ MODIFIED: 檔案上傳監聽器現在呼叫新的輔助函式，程式碼更簡潔
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleImageFile(file);
        }
    });

    // ✨ NEW: 為輸入框新增貼上事件的監聽器
    textarea.addEventListener('paste', (e) => {
        // 取得剪貼簿中的項目
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let imageFound = false;
        
        for (const item of items) {
            // 如果項目是檔案且類型為圖片
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const imageFile = item.getAsFile();
                handleImageFile(imageFile); // 使用剛剛建立的輔助函式處理
                imageFound = true;
                break; // 只處理第一張圖片
            }
        }

        // 如果貼上的是圖片，就阻止瀏覽器的預設貼上行為(例如貼上檔案路徑文字)
        if (imageFound) {
            e.preventDefault();
        }
    });


    // --- 輸入與傳送邏輯 (維持不變) ---
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const prompt = textarea.value.trim();
        if (!prompt && !chatImageCache) return;

        addMessageToChat('user', prompt, chatImageCache);
        chrome.runtime.sendMessage({
            action: 'chat',
            prompt: prompt,
            imageDataUrl: chatImageCache
        });

        // 重設輸入區
        textarea.value = '';
        textarea.style.height = 'auto';
        chatImageCache = null;
        const filePreview = document.getElementById('gemini-chat-file-preview');
        filePreview.style.display = 'none';
        filePreview.innerHTML = '';
        fileInput.value = '';

        addChatLoading();
    });
}
        // ✨ NEW: 新增/移除聊天載入動畫的函式
        function addChatLoading() {
            const messagesDiv = document.getElementById('gemini-chat-messages');
            if (document.getElementById('gemini-chat-loader-msg')) return;
            const loaderMessage = document.createElement('div');
            loaderMessage.id = 'gemini-chat-loader-msg';
            loaderMessage.className = 'gemini-chat-message model';
            loaderMessage.innerHTML = `<div class="gemini-chat-loader"><span></span><span></span><span></span></div>`;
            messagesDiv.appendChild(loaderMessage);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        function removeChatLoading() {
            const loaderMessage = document.getElementById('gemini-chat-loader-msg');
            if (loaderMessage) loaderMessage.remove();
        }

        // ✨ NEW: 將訊息加入聊天畫面的函式
        function addMessageToChat(role, text, imageUrl = null) {
            const messagesDiv = document.getElementById('gemini-chat-messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = `gemini-chat-message ${role}`;

            if (role === 'model') {
                 renderMarkdownAndMath(messageDiv, text);
            } else {
                 const textNode = document.createElement('div');
                 textNode.textContent = text;
                 messageDiv.appendChild(textNode);
            }

            if (imageUrl) {
                const img = document.createElement('img');
                img.src = imageUrl;
                img.className = 'gemini-chat-image-preview';
                messageDiv.appendChild(img);
            }

            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
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
                if (enableSwitch && e.target.closest('.gemini-switch')) {
                     const checkbox = e.target.closest('.gemini-switch').querySelector('input');
                     if(checkbox) {
                        const isChecked = e.target === checkbox ? checkbox.checked : !checkbox.checked;
                        chrome.storage.sync.set({ isTranslatorEnabled: isChecked });
                     }
                }
            });
        }
        
        function main() {
            initializeTranslatorFeatures();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }
    }


    // ===================================================================================
    // ============================= 邏輯 B: 用於所有其他通用網站 =============================
    // ===================================================================================
    function runGenericLogic() {
        (function injectKaTeXFontPaths() {
            const KATEX_FONTS=["KaTeX_AMS-Regular","KaTeX_Caligraphic-Bold","KaTeX_Caligraphic-Regular","KaTeX_Fraktur-Bold","KaTeX_Fraktur-Regular","KaTeX_Main-Bold","KaTeX_Main-BoldItalic","KaTeX_Main-Italic","KaTeX_Main-Regular","KaTeX_Math-BoldItalic","KaTeX_Math-Italic","KaTeX_SansSerif-Bold","KaTeX_SansSerif-Italic","KaTeX_SansSerif-Regular","KaTeX_Script-Regular","KaTeX_Size1-Regular","KaTeX_Size2-Regular","KaTeX_Size3-Regular","KaTeX_Size4-Regular","KaTeX_Typewriter-Regular"];
            const FONT_FORMATS={"woff2":"woff2","woff":"woff","ttf":"truetype"};
            let css='';
            for(const font of KATEX_FONTS){
                let srcList=[];
                for(const format in FONT_FORMATS){
                    const url=chrome.runtime.getURL(`fonts/${font}.${format}`);
                    srcList.push(`url(${url}) format('${FONT_FORMATS[format]}')`);
                }
                css+=`
                    @font-face {
                        font-family: '${font.split('-')[0]}';
                        src: ${srcList.join(',\n' + ' '.repeat(17))};
                        font-style: ${font.includes('Italic')?'italic':'normal'};
                        font-weight: ${font.includes('Bold')?'bold':'normal'};
                    }
                `;
            }
            const styleElement=document.createElement('style');
            styleElement.textContent=css;
            (document.head || document.documentElement).appendChild(styleElement);
            console.log('[Gemini] KaTeX 字型路徑已動態注入。');
        })();
        console.log("--- Gemini 翻譯/解釋/聊天插件 content.js v3.8 (通用版) 開始載入... ---");

        let isTranslatorEnabled = true;
        let activeInstances = {};
        let isUpdateLoopRunning = false;
        let isProcessingUITranslation = false;
        let chatImageCache = null; // ✨ NEW: 聊天相關的狀態變數
        
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

                const contentDiv = element.querySelector('.gemini-result-content');
                const currentScrollTop = contentDiv.scrollTop;
                const currentScrollLeft = contentDiv.scrollLeft;
                
                document.body.append(element);
                element.style.position = 'absolute';
                
                contentDiv.scrollTop = currentScrollTop;
                contentDiv.scrollLeft = currentScrollLeft;
                
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
            
            const triggerContainer = document.createElement('div');
            triggerContainer.className = 'gemini-selection-trigger-container gemini-ui-element';
            triggerContainer.dataset.instanceId = instanceId;
            triggerContainer.style.position = 'absolute';

            const translateButton = document.createElement('div');
            translateButton.className = 'gemini-selection-trigger';
            translateButton.innerText = '翻譯';

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
                trigger: triggerContainer,
                text: textToTranslate
            };
            
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
        
        // ✨ MODIFIED: onMessage listener 現在要處理更多種回覆
        chrome.runtime.onMessage.addListener((request, sender) => {
            if ((request.action === 'translationResult' || request.action === 'explanationResult') && request.instanceId) {
                const instance = activeInstances[request.instanceId];
                if (instance && instance.type === 'box' && instance.box) {
                    if (instance.translationTimeout) clearTimeout(instance.translationTimeout);
                    const contentDiv = instance.box.querySelector('.gemini-result-content');
                    if (request.isError) {
                        contentDiv.innerHTML = `<span style="color: red;">${request.text}</span>`;
                        return;
                    }
                    renderMarkdownAndMath(contentDiv, request.text);
                }
                return;
            }
            if (request.action === 'chatResult') {
                removeChatLoading();
                if (request.isError) {
                    addMessageToChat('system', request.text);
                } else {
                    addMessageToChat('model', request.text);
                }
                return;
            }
            if (request.action === 'historyCleared') {
                const messagesDiv = document.getElementById('gemini-chat-messages');
                if(messagesDiv) messagesDiv.innerHTML = '';
                addMessageToChat('system', request.text);
                return;
            }
        });

        // ✨ NEW: 渲染 Markdown 和數學公式的通用函式
        function renderMarkdownAndMath(element, text) {
            function protectMath(text) {
                return text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (match, blockContent, inlineContent) => {
                    const content = blockContent || inlineContent;
                    const escapedContent = content.replace(/_/g, '\\_').replace(/\^/g, '\\^').replace(/\*/g, '\\*');
                    return blockContent ? `$$${escapedContent}$$` : `$${escapedContent}$`;
                });
            }
            const protectedText = protectMath(text);
            let htmlContent;
            if (window.marked) {
                try { htmlContent = window.marked.parse(protectedText); } catch (e) {
                    console.error('[Gemini] marked.js 解析時發生錯誤:', e);
                    htmlContent = protectedText.replace(/\n/g, '<br>');
                }
            } else {
                console.error('[Gemini] marked.js 函式庫未載入！');
                htmlContent = protectedText.replace(/\n/g, '<br>');
            }
            element.innerHTML = htmlContent;
            if (window.renderMathInElement) {
                try {
                    renderMathInElement(element, {
                        delimiters: [{left: "$$", right: "$$", display: true}, {left: "$", right: "$", display: false}],
                        throwOnError: false
                    });
                } catch (e) { console.error('[Gemini] KaTeX 渲染時發生錯誤:', e); }
            } else { console.error('[Gemini] KaTeX 的 renderMathInElement 函式未找到！'); }
        }

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
                    const fabMenu = document.getElementById('gemini-fab-menu');
                    if(fabMenu) fabMenu.classList.remove('visible');
                }
            }
        });

        function initializeTranslatorFeatures() {
            if (document.getElementById('gemini-fab')) return;
            createFabAndMenu();
            setupGlobalListeners();
            updateFabState();
        }

        // ✨ MODIFIED: 大幅修改，建立主選單和聊天介面
        function createFabAndMenu() {
            const fab = document.createElement('div');
            fab.id = 'gemini-fab';
            fab.innerText = 'G';
            document.body.appendChild(fab);

            const fabMenu = document.createElement('div');
            fabMenu.id = 'gemini-fab-menu';
            fabMenu.classList.add('gemini-ui-element');

            const isEnabled = isTranslatorEnabled ? 'checked' : '';

            const mainMenuHTML = `
                <div id="gemini-menu-main" style="width: 100%;">
                    <div class="gemini-menu-item gemini-pdf-link-item">
                        <a href="https://jason168861.github.io/my-pdf-viewer/" target="_blank" rel="noopener noreferrer">翻譯 PDF 文件</a>
                        <small>瀏覽器預設的 PDF 檢視器不支援，請由此上傳檔案操作。</small>
                    </div>
                    <div class="gemini-menu-separator"></div>
                    <div class="gemini-menu-item" id="gemini-open-chat-btn">
                        <span>💬 開啟 Gemini 聊天室</span>
                    </div>
                    <div class="gemini-menu-separator"></div>
                    <div class="gemini-menu-item">
                        <span>啟用 Gemini 功能</span>
                        <label class="gemini-switch">
                            <input type="checkbox" id="gemini-enable-switch" ${isEnabled}>
                            <span class="gemini-slider"></span>
                        </label>
                    </div>
                </div>
            `;

            const chatViewHTML = `
                <div id="gemini-chat-view" style="display: none;">
                    <div id="gemini-chat-header">
                        <button id="gemini-chat-back-btn" title="返回主選單">‹</button>
                        <span id="gemini-chat-title">Gemini 聊天室</span>
                        <button id="gemini-chat-clear-btn" title="清除聊天記錄">🗑️</button>
                    </div>
                    <div id="gemini-chat-messages"></div>
                    <div id="gemini-chat-input-container">
                         <div id="gemini-chat-file-preview" style="display: none;"></div>
                         <form id="gemini-chat-input-form">
                             <label for="gemini-chat-file-input" id="gemini-chat-file-label" title="上傳圖片/檔案">
                                 <svg viewBox="0 0 24 24"><path d="M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z"></path></svg>
                             </label>
                             <input type="file" id="gemini-chat-file-input" accept="image/jpeg,image/png,image/webp,image/heic">
                             <textarea id="gemini-chat-textarea" rows="1" placeholder="輸入訊息..."></textarea>
                             <button type="submit" id="gemini-chat-send-btn" title="傳送">
                                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"></path></svg>
                             </button>
                         </form>
                    </div>
                </div>
            `;

            fabMenu.innerHTML = mainMenuHTML + chatViewHTML;
            document.body.appendChild(fabMenu);
            setupChatListeners();
        }
            // ✨ NEW: 處理圖片檔案的邏輯被抽成一個可重複使用的函式
        function handleImageFile(file) {
            // 確保傳入的是一個圖片檔案
            if (!file || !file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                chatImageCache = event.target.result;
                const filePreview = document.getElementById('gemini-chat-file-preview');
                
                // 建立預覽畫面和移除按鈕
                filePreview.innerHTML = `<img src="${chatImageCache}" alt="Preview"><button id="gemini-chat-remove-file">&times;</button>`;
                filePreview.style.display = 'block';

                // 為移除按鈕加上事件監聽
                document.getElementById('gemini-chat-remove-file').addEventListener('click', () => {
                    filePreview.style.display = 'none';
                    filePreview.innerHTML = '';
                    chatImageCache = null;
                    // 重設 input 的值，這樣才能再次選擇同一個檔案
                    document.getElementById('gemini-chat-file-input').value = ''; 
                });
            };
            // 讀取檔案並轉為 Base64
            reader.readAsDataURL(file);
        }
// ✨ MODIFIED: 此函式已更新，以整合貼上圖片功能
function setupChatListeners() {
    const mainMenu = document.getElementById('gemini-menu-main');
    const chatView = document.getElementById('gemini-chat-view');
    const fileInput = document.getElementById('gemini-chat-file-input');
    const textarea = document.getElementById('gemini-chat-textarea');
    const form = document.getElementById('gemini-chat-input-form');

    // --- 按鈕切換邏輯 (維持不變) ---
    document.getElementById('gemini-open-chat-btn').addEventListener('click', () => {
        mainMenu.style.display = 'none';
        chatView.style.display = 'flex';
        if (document.getElementById('gemini-chat-messages').childElementCount === 0) {
            addMessageToChat('system', '你好！我可以為你做什麼？');
        }
    });
    document.getElementById('gemini-chat-back-btn').addEventListener('click', () => {
        chatView.style.display = 'none';
        mainMenu.style.display = 'block';
    });
    document.getElementById('gemini-chat-clear-btn').addEventListener('click', () => {
        if(confirm('確定要清除本次的所有聊天記錄嗎？')) {
            chrome.runtime.sendMessage({ action: 'clearChatHistory' });
        }
    });

    // ✨ MODIFIED: 檔案上傳監聽器現在呼叫新的輔助函式，程式碼更簡潔
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            handleImageFile(file);
        }
    });

    // ✨ NEW: 為輸入框新增貼上事件的監聽器
    textarea.addEventListener('paste', (e) => {
        // 取得剪貼簿中的項目
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        let imageFound = false;
        
        for (const item of items) {
            // 如果項目是檔案且類型為圖片
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                const imageFile = item.getAsFile();
                handleImageFile(imageFile); // 使用剛剛建立的輔助函式處理
                imageFound = true;
                break; // 只處理第一張圖片
            }
        }

        // 如果貼上的是圖片，就阻止瀏覽器的預設貼上行為(例如貼上檔案路徑文字)
        if (imageFound) {
            e.preventDefault();
        }
    });


    // --- 輸入與傳送邏輯 (維持不變) ---
    textarea.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = (textarea.scrollHeight) + 'px';
    });

    textarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            form.dispatchEvent(new Event('submit'));
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const prompt = textarea.value.trim();
        if (!prompt && !chatImageCache) return;

        addMessageToChat('user', prompt, chatImageCache);
        chrome.runtime.sendMessage({
            action: 'chat',
            prompt: prompt,
            imageDataUrl: chatImageCache
        });

        // 重設輸入區
        textarea.value = '';
        textarea.style.height = 'auto';
        chatImageCache = null;
        const filePreview = document.getElementById('gemini-chat-file-preview');
        filePreview.style.display = 'none';
        filePreview.innerHTML = '';
        fileInput.value = '';

        addChatLoading();
    });
}

        // ✨ NEW: 新增/移除聊天載入動畫的函式
        function addChatLoading() {
            const messagesDiv = document.getElementById('gemini-chat-messages');
            if (document.getElementById('gemini-chat-loader-msg')) return;
            const loaderMessage = document.createElement('div');
            loaderMessage.id = 'gemini-chat-loader-msg';
            loaderMessage.className = 'gemini-chat-message model';
            loaderMessage.innerHTML = `<div class="gemini-chat-loader"><span></span><span></span><span></span></div>`;
            messagesDiv.appendChild(loaderMessage);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
        function removeChatLoading() {
            const loaderMessage = document.getElementById('gemini-chat-loader-msg');
            if (loaderMessage) loaderMessage.remove();
        }

        // ✨ NEW: 將訊息加入聊天畫面的函式
        function addMessageToChat(role, text, imageUrl = null) {
            const messagesDiv = document.getElementById('gemini-chat-messages');
            const messageDiv = document.createElement('div');
            messageDiv.className = `gemini-chat-message ${role}`;

            if (role === 'model') {
                 renderMarkdownAndMath(messageDiv, text);
            } else {
                 const textNode = document.createElement('div');
                 textNode.textContent = text;
                 messageDiv.appendChild(textNode);
            }

            if (imageUrl) {
                const img = document.createElement('img');
                img.src = imageUrl;
                img.className = 'gemini-chat-image-preview';
                messageDiv.appendChild(img);
            }

            messagesDiv.appendChild(messageDiv);
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }

        function setupGlobalListeners() {
            document.addEventListener('mouseup', (e) => {
                if (!isTranslatorEnabled) return;
                const clickedOnOurUI = e.target.closest('.gemini-ui-element, #gemini-fab');
                if (clickedOnOurUI) {
                    return;
                }
                cleanupAllTriggers();
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
                if (enableSwitch && e.target.closest('.gemini-switch')) {
                     const checkbox = e.target.closest('.gemini-switch').querySelector('input');
                     if(checkbox) {
                        const isChecked = e.target === checkbox ? checkbox.checked : !checkbox.checked;
                        chrome.storage.sync.set({ isTranslatorEnabled: isChecked });
                     }
                }
            });
        }
        
        function main() {
            initializeTranslatorFeatures();
        }

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', main);
        } else {
            main();
        }
    }

})();