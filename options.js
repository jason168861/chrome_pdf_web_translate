// options.js
document.addEventListener('DOMContentLoaded', () => {
    const apiKeyInput = document.getElementById('api-key');
    const saveButton = document.getElementById('save-btn');
    const statusDiv = document.getElementById('status');

    // 1. 頁面載入時，讀取已儲存的金鑰並顯示在輸入框中
    chrome.storage.sync.get(['geminiApiKey'], (result) => {
        if (result.geminiApiKey) {
            apiKeyInput.value = result.geminiApiKey;
        }
    });

    // 2. 當使用者點擊「儲存」按鈕時
    saveButton.addEventListener('click', () => {
        const apiKey = apiKeyInput.value.trim();
        // if (apiKey) {
            // 將金鑰儲存到 chrome.storage.sync
        chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
            statusDiv.textContent = '金鑰已成功儲存！';
            statusDiv.style.color = 'green';
            setTimeout(() => {
                statusDiv.textContent = '';
            }, 2500);
        });
        // } 
        // else {
        //     statusDiv.textContent = '請輸入有效的金鑰。';
        //     statusDiv.style.color = 'red';
        // }
    });
});