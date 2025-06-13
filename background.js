// background.js (Final, v2.1 - 新增聊天功能)

const API_URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=`; // ✨ MODIFIED: 使用 vision 模型以支援圖片
const API_URL_TEXT_ONLY_BASE = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=`; // ✨ NEW: 為純文字功能保留 flash 模型

chrome.runtime.onInstalled.addListener((details) => {
    chrome.storage.sync.set({ isTranslatorEnabled: true });
    // 當擴充功能首次安裝時，自動打開選項頁面，引導使用者設定金鑰
    if (details.reason === 'install') {
        chrome.runtime.openOptionsPage();
    }
});

// 點擊擴充功能圖示時，打開選項頁面
chrome.action.onClicked.addListener((tab) => {
    chrome.runtime.openOptionsPage();
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    let promise;
    switch (request.action) {
        case 'translate':
            promise = callGeminiAPIForTranslation(request.text);
            break;
        case 'explain':
            promise = callGeminiAPIForExplanation(request.text);
            break;
        // ✨ NEW: 新增 chat 和 clearChatHistory 兩個 action
        case 'chat':
            promise = callGeminiAPIForChat(request.prompt, request.imageDataUrl);
            break;
        case 'clearChatHistory':
            promise = chrome.storage.session.remove('chatHistory').then(() => "聊天記錄已清除。");
            break;
        default:
            // 未知 action，直接返回
            return;
    }

    promise
        .then(resultText => {
            // ✨ MODIFIED: 根據不同的 action 回傳對應的 result action
            let resultAction;
            if (request.action === 'translate') resultAction = 'translationResult';
            else if (request.action === 'explain') resultAction = 'explanationResult';
            else if (request.action === 'chat') resultAction = 'chatResult';
            else if (request.action === 'clearChatHistory') resultAction = 'historyCleared';

            if (resultAction) {
                const messagePayload = {
                    action: resultAction,
                    text: resultText,
                };
                // 只有 translate 和 explain 需要 instanceId
                if (request.instanceId) {
                    messagePayload.instanceId = request.instanceId;
                }
                chrome.tabs.sendMessage(sender.tab.id, messagePayload);
            }
        })
        .catch(error => {
            console.error(`[Gemini BG] Action '${request.action}' failed:`, error);
            let errorAction;
            if (request.action === 'translate') errorAction = 'translationResult';
            else if (request.action === 'explain') errorAction = 'explanationResult';
            else if (request.action === 'chat') errorAction = 'chatResult'; // 聊天失敗也回傳

            if (errorAction) {
                 const errorPayload = {
                    action: errorAction,
                    text: `操作失敗: ${error.message}`,
                    isError: true, // ✨ NEW: 增加錯誤旗標
                 };
                 if (request.instanceId) {
                     errorPayload.instanceId = request.instanceId;
                 }
                chrome.tabs.sendMessage(sender.tab.id, errorPayload);
            }
        });

    return true; // 保持異步通訊
});


// callGeminiAPIForExplanation and callGeminiAPIForTranslation 兩個函式維持不變
async function callGeminiAPIForExplanation(text) {
    const systemInstruction = {
        parts: [{
            text: `You are an expert at explaining complex concepts in simple terms. Your task is to explain the provided text in **Traditional Chinese (繁體中文)**.

## Rules:
1.  **Audience:** Assume you are explaining to someone who is smart but not an expert in the subject, like a high school student or an interested layman.
2.  **Language:** Use clear, concise, and easy-to-understand Traditional Chinese. Avoid jargon where possible, or explain it if necessary.
3.  **Format:**
    * Start with a one-sentence summary: "簡單來說，這段話的意思是...".
    * Then, provide a more detailed explanation in one or more paragraphs.
    * Use bullet points or numbered lists or markdown if it helps to break down the information.
4.  **Tone:** Be helpful, patient, and engaging.
5.  **✨ VERY IMPORTANT - Math Formatting:**
    * For mathematical formulas, you MUST use LaTeX syntax.
    * Enclose inline formulas with single dollar signs. **Example: $E = mc^2$**.
    * Enclose display (block) formulas with double dollar signs. **Example: $$\\sum_{i=1}^n x_i$$**.
    * **DO NOT** use Markdown backticks (\`) for formulas.
6.  **Output:** Only output the explanation content, without any extra conversation like "Here is the explanation:".`
        }]
    };

    const userPrompt = `Please explain the following text:\n\n"${text}"`;
    // ✨ MODIFIED: 使用新的 text-only URL
    return await callGeminiAPI(systemInstruction, userPrompt, 0.7, false);
}

async function callGeminiAPIForTranslation(text) {
     const systemInstruction = {
        parts: [{
            text: `You are a professional Traditional Chinese native translator who needs to fluently translate text into Traditional Chinese.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here's the translation:" or "Translation as follows:")
2. The returned translation must maintain exactly the same number of paragraphs and format as the original text
3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency
4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.

## OUTPUT FORMAT:
- **Single paragraph input** → Output translation directly (no separators, no extra text)
- **Multi-paragraph input** → Use %% as paragraph separator between translations`
        }]
    };
    const userPrompt = `Translate to "Traditional Chinese". The text to translate is:\n\n"${text}"`;
    // ✨ MODIFIED: 使用新的 text-only URL
    return await callGeminiAPI(systemInstruction, userPrompt, 0.1, false);
}

// ✨ NEW: 全新的函式，專為聊天功能設計
// ✨ MODIFIED: 為聊天功能加入繁體中文的系統指令
async function callGeminiAPIForChat(prompt, imageDataUrl) {
    // ✨ NEW: 為聊天功能定義系統指令
    const systemInstruction = {
        parts: [{
            text: "You are a helpful and creative assistant. If you use Chinese in your response, you MUST use **Traditional Chinese (繁體中文)**. Do not use Simplified Chinese."
        }]
    };

    const { chatHistory = [] } = await chrome.storage.session.get('chatHistory');

    const userParts = [{ text: prompt }];

    // 如果有圖片資料，加入到請求中
    if (imageDataUrl) {
        const match = imageDataUrl.match(/^data:(image\/.+);base64,(.+)$/);
        if (match) {
            const mimeType = match[1];
            const base64Data = match[2];
            userParts.push({
                inline_data: {
                    mime_type: mimeType,
                    data: base64Data
                }
            });
        }
    }

    // 將新訊息加入歷史紀錄
    chatHistory.push({
        role: 'user',
        parts: userParts
    });

    // ✨ MODIFIED: 將新的 systemInstruction 傳遞給底層 API 呼叫函式
    const modelResponseText = await callGeminiAPI(systemInstruction, chatHistory, 0.7, true);

    // 將模型的回答也加入歷史紀錄
    chatHistory.push({
        role: 'model',
        parts: [{ text: modelResponseText }]
    });

    // 更新 session 中的歷史紀錄
    await chrome.storage.session.set({ chatHistory });

    return modelResponseText;
}


// ✨ MODIFIED: 核心修改：callGeminiAPI 現在會處理多種請求類型
async function callGeminiAPI(systemInstruction, promptOrHistory, temperature, isChat = false) {
    try {
        const data = await chrome.storage.sync.get('geminiApiKey');
        const geminiApiKey = data.geminiApiKey;

        if (!geminiApiKey) {
            throw new Error("尚未設定 Gemini API 金鑰。請點擊擴充功能圖示進入選項頁面設定。");
        }

        let API_URL;
        let payload;

        // 根據是否為聊天模式，建立不同的請求體和 URL
        if (isChat) {
            API_URL = API_URL_BASE + geminiApiKey; // Vision 模型
            payload = {
                // ✨ NEW: 為聊天模式也加入 systemInstruction
                "systemInstruction": systemInstruction,
                "contents": promptOrHistory,
                "generationConfig": { "temperature": temperature, "maxOutputTokens": 8192 } // 聊天模式用較少的 token
            };
        } else {
            API_URL = API_URL_TEXT_ONLY_BASE + geminiApiKey; // Flash 模型
            payload = {
                "systemInstruction": systemInstruction,
                "contents": [{ "parts": [{ "text": promptOrHistory }] }],
                "generationConfig": { "temperature": temperature, "maxOutputTokens": 32768 }
            };
        }
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorData = await response.json();
            if (response.status === 400 || response.status === 403) {
                 throw new Error(`API 金鑰可能無效或權限不足。請檢查您的金鑰設定。(錯誤: ${errorData.error?.message || response.status})`);
            }
             // 處理 Vision 模型對於不支援圖片格式的特定錯誤
            if (errorData.error?.message.includes("Image format is not supported")) {
                 throw new Error("上傳的檔案格式不支援，請嘗試 JPG, PNG, WEBP 或 HEIC 格式的圖片。");
            }
            throw new Error(errorData.error?.message || `HTTP 錯誤! 狀態碼: ${response.status}`);
        }
        const responseData = await response.json();

        // 處理可能的空回覆 (安全檢查)
        if (responseData.candidates && responseData.candidates[0]?.content?.parts?.[0]?.text) {
            return responseData.candidates[0].content.parts[0].text.trim();
        } else if (responseData.candidates?.[0]?.finishReason === "SAFETY") {
             throw new Error("由於安全設定，Gemini 拒絕回答。");
        } else {
            console.warn("API 回應格式不符預期或為空:", responseData);
            throw new Error("API 回應中沒有有效的內容。可能是網路問題或模型限制。");
        }
    } catch (error) {
        console.error('呼叫 Gemini API 時發生錯誤:', error);
        throw error; // 將錯誤向上拋出
    }
}