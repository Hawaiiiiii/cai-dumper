export interface ChatMessage {
  turn_index: number;
  role: 'user' | 'char' | 'system';
  name: string;
  text: string;
  timestamp?: string;
}

export interface ChatExport {
  id: string;
  character_name: string;
  messages: ChatMessage[];
  metadata?: {
    exported_at: string;
    source_url: string;
  };
}

export enum AnalysisType {
  SUMMARY = 'SUMMARY',
  TIMELINE = 'TIMELINE',
  CONSISTENCY = 'CONSISTENCY',
  CHAPTERS = 'CHAPTERS'
}

export interface AnalysisResult {
  type: AnalysisType;
  markdown: string;
  timestamp: string;
}

export type ViewState = 'DASHBOARD' | 'SCRAPER' | 'VIEWER' | 'ANALYSIS' | 'ARCHITECTURE';
