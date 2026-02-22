import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { spawn, ChildProcess } from 'child_process'
import path from 'path'

// Plugin to start the backend server during development
function backendServer() {
  let serverProcess: ChildProcess | null = null;

  return {
    name: 'backend-server',
    configureServer() {
      const serverDir = path.resolve(__dirname, 'server');

      console.log('\x1b[36m%s\x1b[0m', '🚀 Starting backend server...');

      serverProcess = spawn('node', ['index.js'], {
        cwd: serverDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PORT: '3001' }
      });

      serverProcess.stdout?.on('data', (data) => {
        console.log('\x1b[35m[server]\x1b[0m', data.toString().trim());
      });

      serverProcess.stderr?.on('data', (data) => {
        console.error('\x1b[31m[server]\x1b[0m', data.toString().trim());
      });

      serverProcess.on('error', (err) => {
        console.error('\x1b[31m[server] Failed to start:\x1b[0m', err.message);
      });

      // Clean up on exit
      process.on('exit', () => {
        serverProcess?.kill();
      });
      process.on('SIGINT', () => {
        serverProcess?.kill();
        process.exit();
      });
      process.on('SIGTERM', () => {
        serverProcess?.kill();
        process.exit();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), backendServer()],
})
