import { GoogleGenAI } from "@google/genai";
import { ChatMessage, AnalysisType } from '../types';

export class GeminiService {
  private client: GoogleGenAI | null = null;
  private apiKey: string | null = null;

  constructor() {
    // In a real env, this might come from environment, but for this demo 
    // we will check if it's available or ask user (handled in UI layer usually, 
    // but here we assume the process.env is injected by the platform or we handle it gracefully).
    if (process.env.API_KEY) {
      this.apiKey = process.env.API_KEY;
      this.client = new GoogleGenAI({ apiKey: this.apiKey });
    }
  }

  isConfigured(): boolean {
    return !!this.client;
  }

  // Allow setting key at runtime if not in env
  setApiKey(key: string) {
    this.apiKey = key;
    this.client = new GoogleGenAI({ apiKey: key });
  }

  async analyzeChat(messages: ChatMessage[], type: AnalysisType, characterName: string = "Character"): Promise<string> {
    if (!this.client) throw new Error("API Key not set");

    // Prepare context (limit to last ~30k tokens for demo speed/cost, or full if possible)
    // We convert messages to a simple string format
    const transcript = messages.map(m => `${m.role === 'user' ? 'User' : characterName}: ${m.text}`).join('\n\n');

    let prompt = "";
    let systemInstruction = "You are an expert literary analyst and data scientist specialized in analyzing roleplay chat logs.";

    switch (type) {
      case AnalysisType.SUMMARY:
        prompt = `Please provide a detailed summary of the following chat log. 
        Focus on the main narrative arc, key turning points, and the relationship development between the User and ${characterName}.
        
        Output format: Markdown.`;
        break;
      
      case AnalysisType.TIMELINE:
        prompt = `Extract a chronological timeline of significant events from the chat log.
        Ignore small talk. Focus on actions, scene changes, and major revelations.
        
        Output format: Markdown list with estimated relative timing if possible.`;
        break;

      case AnalysisType.CONSISTENCY:
        prompt = `Analyze ${characterName}'s behavior for consistency.
        1. Identify their core personality traits based on the text.
        2. Detect any contradictions or hallucinations where they contradict previous statements.
        3. Rate the roleplay quality (1-10) based on adherence to character.
        
        Output format: Markdown report.`;
        break;

      case AnalysisType.CHAPTERS:
        prompt = `Segment this chat log into "Chapters" or "Scenes".
        For each chapter, provide:
        - A Title
        - A one-sentence summary
        - The turn_index range (start to end)
        
        Output format: JSON.`;
        break;
    }

    try {
      const response = await this.client.models.generateContent({
        model: 'gemini-3-flash-preview', // Good balance of speed/window
        contents: [
          {
            role: 'user',
            parts: [
              { text: `CHAT LOG:\n${transcript}\n\n---\n\nTASK: ${prompt}` }
            ]
          }
        ],
        config: {
          systemInstruction: systemInstruction,
          // Only use JSON mime type if strictly requested, mostly we want MD
          responseMimeType: type === AnalysisType.CHAPTERS ? "application/json" : "text/plain",
        }
      });

      return response.text || "No analysis generated.";
    } catch (error) {
      console.error("Gemini Analysis Error:", error);
      throw error;
    }
  }
}

export const geminiService = new GeminiService();
