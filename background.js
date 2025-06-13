// background.js (Final, 使用者可自訂 API Key)

// 移除硬式編碼的金鑰和完整的 URL
const API_URL_BASE = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=`;

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
    if (request.action === 'translate' || request.action === 'explain') {
        const promise = (request.action === 'translate')
            ? callGeminiAPIForTranslation(request.text)
            : callGeminiAPIForExplanation(request.text);

        promise
            .then(resultText => {
                chrome.tabs.sendMessage(sender.tab.id, {
                    action: request.action === 'translate' ? 'translationResult' : 'explanationResult',
                    text: resultText,
                    instanceId: request.instanceId
                });
            })
            .catch(error => {
                chrome.tabs.sendMessage(sender.tab.id, {
                    action: request.action === 'translate' ? 'translationResult' : 'explanationResult',
                    text: `${request.action === 'translate' ? '翻譯' : '解釋'}失敗: ${error.message}`,
                    instanceId: request.instanceId
                });
            });
        return true; // 保持異步通訊
    }
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
    
    // ✨ 修改：為「解釋」功能傳入較高的 temperature (例如 0.7)，增加輸出的流暢度和創意
    return await callGeminiAPI(systemInstruction, userPrompt, 0.7);
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

    // ✨ 修改：為「翻譯」功能傳入較低的 temperature (例如 0.1)，確保輸出的精確度和穩定性
    return await callGeminiAPI(systemInstruction, userPrompt, 0.1);
}

// ✨ 核心修改：callGeminiAPI 現在會先從 storage 取得金鑰
async function callGeminiAPI(systemInstruction, userPrompt, temperature) {
    try {
        // 1. 從 storage 中取得 API 金鑰
        const data = await chrome.storage.sync.get('geminiApiKey');
        const geminiApiKey = data.geminiApiKey;

        // 2. 檢查金鑰是否存在
        if (!geminiApiKey) {
            throw new Error("尚未設定 Gemini API 金鑰。請點擊擴充功能圖示進入選項頁面設定。");
        }

        const API_URL = API_URL_BASE + geminiApiKey;

        const response = await fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                "systemInstruction": systemInstruction,
                "contents": [{ "parts": [{ "text": userPrompt }] }],
                "generationConfig": { "temperature": temperature, "maxOutputTokens": 32768 }
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            // 提供更具體的錯誤，幫助使用者判斷是否為金鑰問題
            if (response.status === 400 || response.status === 403) {
                throw new Error(`API 金鑰可能無效或權限不足。請檢查您的金鑰設定。(錯誤: ${errorData.error?.message || response.status})`);
            }
            throw new Error(errorData.error?.message || `HTTP 錯誤! 狀態碼: ${response.status}`);
        }
        const responseData = await response.json();

        if (responseData.candidates && responseData.candidates[0]?.content?.parts?.[0]?.text) {
            return responseData.candidates[0].content.parts[0].text.trim();
        } else {
            console.warn("API 回應格式不符預期:", responseData);
            throw new Error("API 回應中沒有有效的內容。");
        }
    } catch (error) {
        console.warn('呼叫 Gemini API 時發生錯誤:', error);
        throw error; // 將錯誤向上拋出，以便 onMessage 能捕捉到
    }
}