import React, { useState } from 'react';
import { ChatMessage, AnalysisType, AnalysisResult } from '../types';
import { geminiService } from '../services/geminiService';
import ReactMarkdown from 'react-markdown';
import { Sparkles, Clock, BookOpen, AlertCircle, Loader2 } from 'lucide-react';

interface AnalyzerProps {
  messages: ChatMessage[];
  characterName: string;
}

const Analyzer: React.FC<AnalyzerProps> = ({ messages, characterName }) => {
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [results, setResults] = useState<AnalysisResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async (type: AnalysisType) => {
    setIsAnalyzing(true);
    setError(null);
    try {
      const markdown = await geminiService.analyzeChat(messages, type, characterName);
      
      setResults(prev => [
        { type, markdown, timestamp: new Date().toISOString() },
        ...prev
      ]);
    } catch (err: any) {
        if (err.message?.includes("API Key")) {
            setError("Missing API Key. Please provide one in the code or environment.");
        } else {
            setError("Analysis failed. Please try again later.");
        }
    } finally {
      setIsAnalyzing(false);
    }
  };

  const AnalysisOption = ({ type, label, icon: Icon, desc }: any) => (
    <button
      onClick={() => runAnalysis(type)}
      disabled={isAnalyzing}
      className="flex flex-col items-start p-4 bg-gray-800 border border-gray-700 rounded-xl hover:bg-gray-750 hover:border-gray-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed group text-left"
    >
      <div className="p-2 bg-gray-900 rounded-lg mb-3 group-hover:bg-gray-800 border border-gray-700 transition-colors">
        <Icon className="text-amber-400" size={20} />
      </div>
      <h3 className="font-semibold text-gray-200 mb-1">{label}</h3>
      <p className="text-xs text-gray-400">{desc}</p>
    </button>
  );

  return (
    <div className="p-8 h-full overflow-y-auto bg-gray-950">
      <div className="max-w-4xl mx-auto space-y-8">
        
        <div className="flex items-center justify-between">
            <div>
                <h2 className="text-2xl font-bold text-gray-100 flex items-center gap-2">
                <Sparkles className="text-amber-400" />
                AI Analysis Suite
                </h2>
                <p className="text-gray-400 mt-1">Powered by Gemini 3 Flash. Deep inspect your roleplay sessions.</p>
            </div>
            
            {!geminiService.isConfigured() && (
                 <div className="bg-red-500/10 border border-red-500/20 px-4 py-2 rounded text-red-400 text-sm flex items-center gap-2">
                    <AlertCircle size={16} />
                    API Key Not Configured (Simulated Mode)
                 </div>
            )}
        </div>

        {/* Action Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <AnalysisOption 
            type={AnalysisType.SUMMARY} 
            label="Story Summary" 
            icon={BookOpen}
            desc="Generate a high-level narrative summary of the entire chat."
          />
          <AnalysisOption 
            type={AnalysisType.TIMELINE} 
            label="Event Timeline" 
            icon={Clock}
            desc="Extract chronological events and significant plot points."
          />
          <AnalysisOption 
            type={AnalysisType.CONSISTENCY} 
            label="Psych Profile" 
            icon={BrainCircuit}
            desc="Analyze character consistency, hallucinations, and personality traits."
          />
          <AnalysisOption 
            type={AnalysisType.CHAPTERS} 
            label="Chapter Segmentation" 
            icon={BookOpen}
            desc="Automatically split the log into named chapters."
          />
        </div>

        {isAnalyzing && (
            <div className="flex items-center justify-center p-12 border border-gray-800 border-dashed rounded-xl bg-gray-900/30">
                <Loader2 className="animate-spin text-amber-500 mr-3" size={24} />
                <span className="text-gray-400 animate-pulse">Gemini is reading the transcript...</span>
            </div>
        )}

        {error && (
            <div className="p-4 bg-red-900/20 border border-red-500/30 rounded-lg text-red-200 text-sm">
                {error}
            </div>
        )}

        {/* Results Stream */}
        <div className="space-y-6">
          {results.map((res, idx) => (
            <div key={idx} className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden shadow-2xl">
              <div className="bg-gray-800/50 px-6 py-3 border-b border-gray-800 flex justify-between items-center">
                <div className="flex items-center gap-2">
                    <Sparkles size={16} className="text-purple-400" />
                    <span className="font-mono text-sm font-semibold text-purple-200">{res.type} REPORT</span>
                </div>
                <span className="text-xs text-gray-500 font-mono">{new Date(res.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="p-8 prose prose-invert prose-amber max-w-none">
                <ReactMarkdown>{res.markdown}</ReactMarkdown>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
};

// Icon helper
const BrainCircuit = ({className, size}: any) => (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.97-3.284" />
        <path d="M17.97 14.716A4 4 0 0 1 16 18" />
    </svg>
)

export default Analyzer;
