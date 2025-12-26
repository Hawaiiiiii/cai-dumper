import React from 'react';
import { ELECTRON_MAIN_CODE, PLAYWRIGHT_EXPORTER_CODE, PYTHON_ANALYZER_CODE } from '../constants';
import { Copy, Terminal, FileCode, Layers } from 'lucide-react';

const CodeBlock = ({ title, code, lang }: { title: string, code: string, lang: string }) => (
  <div className="bg-gray-950 border border-gray-800 rounded-lg overflow-hidden my-6">
    <div className="flex items-center justify-between px-4 py-2 bg-gray-900 border-b border-gray-800">
      <div className="flex items-center gap-2">
        <FileCode size={16} className="text-amber-500" />
        <span className="text-sm font-mono text-gray-300">{title}</span>
      </div>
      <button 
        onClick={() => navigator.clipboard.writeText(code)}
        className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
      >
        <Copy size={12} /> Copy
      </button>
    </div>
    <div className="p-4 overflow-x-auto">
        <pre className="font-mono text-xs text-gray-300 leading-relaxed">
            <code>{code}</code>
        </pre>
    </div>
  </div>
);

const Architecture: React.FC = () => {
  return (
    <div className="p-8 h-full overflow-y-auto bg-gray-950">
      <div className="max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold mb-6 text-white">System Architecture (V1)</h2>
        
        <div className="prose prose-invert prose-amber max-w-none mb-12">
            <p className="text-lg text-gray-400">
                The CAI Dumper is designed as a hybrid Desktop Application. 
                Due to browser sandboxing, the scraping and filesystem logic must live in the Electron Main process, 
                while this React UI serves as the Renderer.
            </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
            <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
                <Layers className="text-blue-400 mb-4" size={32} />
                <h3 className="text-lg font-semibold text-white mb-2">Electron Host</h3>
                <p className="text-sm text-gray-400">
                    Manages the persistent Chromium session and handles OS-level file operations.
                    Bridges the UI and Playwright via IPC.
                </p>
            </div>
            <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
                <Terminal className="text-green-400 mb-4" size={32} />
                <h3 className="text-lg font-semibold text-white mb-2">Playwright Engine</h3>
                <p className="text-sm text-gray-400">
                    Executes the scrolling, DOM extraction, and virtualization handling inside the 
                    Character.AI tab context.
                </p>
            </div>
            <div className="p-6 bg-gray-900 rounded-xl border border-gray-800">
                <FileCode className="text-yellow-400 mb-4" size={32} />
                <h3 className="text-lg font-semibold text-white mb-2">Python Pipeline</h3>
                <p className="text-sm text-gray-400">
                    Optional heavy-lifting for tokenization, NLP processing, and generating large-scale 
                    Markdown reports offline.
                </p>
            </div>
        </div>

        <hr className="border-gray-800 mb-12" />

        <h3 className="text-xl font-bold text-white mb-4">1. Electron Main Process</h3>
        <p className="text-gray-400 mb-2">Responsible for launching the headful browser and IPC handling.</p>
        <CodeBlock title="main.js" lang="javascript" code={ELECTRON_MAIN_CODE} />

        <h3 className="text-xl font-bold text-white mb-4">2. Playwright Exporter Logic</h3>
        <p className="text-gray-400 mb-2">The core logic for scrolling virtualized lists and scraping DOM.</p>
        <CodeBlock title="exporter.ts" lang="typescript" code={PLAYWRIGHT_EXPORTER_CODE} />

        <h3 className="text-xl font-bold text-white mb-4">3. Python Analysis Script</h3>
        <p className="text-gray-400 mb-2">For post-processing JSONL files into clean formats.</p>
        <CodeBlock title="analyzer.py" lang="python" code={PYTHON_ANALYZER_CODE} />
      </div>
    </div>
  );
};

export default Architecture;
