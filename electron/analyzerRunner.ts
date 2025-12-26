import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

export function resolveAnalyzerPath(): { scriptPath: string; tried: string[] } {
  // Candidate locations (in order of preference)
  const projectRoot = path.resolve(__dirname, '..', '..');
  const appPath = app.getAppPath();
  const candidates = [
    path.join(projectRoot, 'python', 'analyzer.py'),
    path.join(appPath, 'python', 'analyzer.py'),
    path.join(process.cwd(), 'python', 'analyzer.py'),
    path.join(__dirname, '../python', 'analyzer.py'),
  ];

  const tried: string[] = [];
  for (const candidate of candidates) {
    tried.push(candidate);
    if (fs.existsSync(candidate)) {
      return { scriptPath: candidate, tried };
    }
  }

  throw new Error(`Unable to locate analyzer.py. Tried:\n${tried.join('\n')}`);
}

export function runPythonAnalysis(scriptPath: string, jsonlPath: string, onLog: (msg: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    onLog(`Starting Python analysis on ${jsonlPath}...`);
    
    const pythonProcess = spawn('python', [scriptPath, jsonlPath]);
    
    let outputData = '';

    pythonProcess.stdout.on('data', (data) => {
      const msg = data.toString();
      onLog(`[Python] ${msg}`);
      outputData += msg;
    });

    pythonProcess.stderr.on('data', (data) => {
      onLog(`[Python ERR] ${data.toString()}`);
    });

    pythonProcess.on('close', (code) => {
      if (code === 0) {
        onLog("Analysis complete.");
        resolve(outputData);
      } else {
        reject(new Error(`Python script exited with code ${code}`));
      }
    });
  });
}
