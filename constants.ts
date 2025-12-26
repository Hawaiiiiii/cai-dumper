export const DEMO_CHAT_LOG = [
  { turn_index: 0, role: 'user', name: 'User', text: 'Hello, are you sentient?' },
  { turn_index: 1, role: 'char', name: 'AI Assistant', text: 'I am a large language model, trained by Google.' },
  { turn_index: 2, role: 'user', name: 'User', text: 'That is cool. What can you do?' },
  { turn_index: 3, role: 'char', name: 'AI Assistant', text: 'I can help with analysis, coding, and creative writing.' },
];

export const ELECTRON_MAIN_CODE = `
// main.js (Electron Main Process)
const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const { chromium } = require('playwright'); // Use Playwright directly
const fs = require('fs/promises');

let mainWindow;
let browserContext; // Persistent Playwright context

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile('index.html');
}

app.whenReady().then(createWindow);

// 1. Launch Persistent Browser
ipcMain.handle('launch-browser', async () => {
  const userDataDir = path.join(app.getPath('userData'), 'cai_profile');
  browserContext = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Headful for manual login
    viewport: null,
    args: ['--start-maximized']
  });
  
  const page = await browserContext.newPage();
  await page.goto('https://character.ai');
  return "Browser launched. Please log in manually.";
});

// 2. Scrape Chats
ipcMain.handle('scrape-chat', async (event, chatUrl) => {
  if (!browserContext) throw new Error("Browser not launched");
  const pages = browserContext.pages();
  const page = pages[0] || await browserContext.newPage();
  
  await page.goto(chatUrl);
  
  // Logic to scroll to top and collect messages
  // This interacts with the Playwright Exporter Module
  const messages = await page.evaluate(scrapeLogic); 
  return messages;
});

// 3. Save Export
ipcMain.handle('save-file', async (event, { data, filename }) => {
  const filePath = path.join(app.getPath('documents'), 'CAI_Exports', filename);
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
  return filePath;
});
`;

export const PLAYWRIGHT_EXPORTER_CODE = `
// exporter.ts (Playwright Logic)

/**
 * Scrolls to the top of the chat to load full history.
 * CAI uses virtualized lists, so we must scrape incrementally or 
 * force load everything into DOM if possible (risky).
 * 
 * Better strategy: Scroll up repeatedly until 'scrollTop' doesn't change
 * or a "beginning of chat" indicator is found.
 */
export async function scrollToTop(page) {
  let previousHeight = 0;
  let retries = 0;
  
  while(retries < 10) {
    // Select the scrollable container
    const scrollable = await page.locator('[class*="ChatMessages"]'); 
    
    // Scroll up
    await scrollable.evaluate(el => el.scrollTop = 0);
    
    // Wait for network idle or DOM update
    await page.waitForTimeout(1000); 
    
    const newHeight = await scrollable.evaluate(el => el.scrollHeight);
    if (newHeight === previousHeight) {
        retries++;
    } else {
        previousHeight = newHeight;
        retries = 0;
    }
  }
}

/**
 * Extracts messages from the DOM.
 * Returns an array of standardized objects.
 */
export async function extractMessages(page) {
  // Use a broad selector and filter
  const messageDivs = await page.locator('[data-testid="message-row"]').all();
  
  const transcript = [];
  let index = 0;
  
  for (const div of messageDivs) {
    const text = await div.innerText();
    const isUser = await div.getAttribute('data-is-user') === 'true';
    
    transcript.push({
      turn_index: index++,
      role: isUser ? 'user' : 'char',
      text: text.trim(),
      // Attempt to find timestamp in child nodes
    });
  }
  
  return transcript;
}
`;

export const PYTHON_ANALYZER_CODE = `
# analyzer.py
import json
import os
from typing import List, Dict

def load_jsonl(filepath: str) -> List[Dict]:
    with open(filepath, 'r', encoding='utf-8') as f:
        return [json.loads(line) for line in f]

def chunk_chat(messages: List[Dict], max_tokens: int = 4000) -> List[str]:
    """Chunks messages for LLM context windows."""
    chunks = []
    current_chunk = []
    current_len = 0
    
    for msg in messages:
        text = f"{msg['role']}: {msg['text']}"
        # Rough token estimation (4 chars ~= 1 token)
        est_tokens = len(text) / 4 
        
        if current_len + est_tokens > max_tokens:
            chunks.append("\\n".join(current_chunk))
            current_chunk = []
            current_len = 0
            
        current_chunk.append(text)
        current_len += est_tokens
        
    if current_chunk:
        chunks.append("\\n".join(current_chunk))
        
    return chunks

def analyze_consistency(messages: List[Dict]):
    # Placeholder for calls to Gemini API or local LLM
    pass

if __name__ == "__main__":
    import sys
    file_path = sys.argv[1]
    data = load_jsonl(file_path)
    print(f"Loaded {len(data)} messages.")
    # Run pipeline...
`;
