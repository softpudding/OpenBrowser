import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';
import type { WebSocket as WSType, WebSocketServer as WSSType } from 'ws';

// Simple plugin to copy manifest.json and assets to dist
const copyManifestPlugin = () => ({
  name: 'copy-manifest',
  closeBundle() {
    const distDir = resolve(__dirname, 'dist');
    if (!existsSync(distDir)) {
      mkdirSync(distDir, { recursive: true });
    }

    // Copy manifest.json
    cpSync(
      resolve(__dirname, 'manifest.json'),
      resolve(distDir, 'manifest.json'),
      { force: true },
    );

    // Copy assets directory
    const assetsSrc = resolve(__dirname, 'assets');
    const assetsDest = resolve(distDir, 'assets');
    if (existsSync(assetsSrc)) {
      cpSync(assetsSrc, assetsDest, { recursive: true, force: true });
    }

    // Copy public directory
    const publicSrc = resolve(__dirname, 'public');
    const publicDest = resolve(distDir, 'public');
    if (existsSync(publicSrc)) {
      cpSync(publicSrc, publicDest, { recursive: true, force: true });
    }

    // Copy UUID page HTML
    const uuidPageSrc = resolve(__dirname, 'src/uuid/uuidPage.html');
    const uuidPageDest = resolve(distDir, 'uuid/uuidPage.html');
    if (existsSync(uuidPageSrc)) {
      // Ensure uuid directory exists
      const uuidDir = resolve(distDir, 'uuid');
      if (!existsSync(uuidDir)) {
        mkdirSync(uuidDir, { recursive: true });
      }
      cpSync(uuidPageSrc, uuidPageDest, { force: true });
      console.log('✅ UUID page HTML copied to dist/uuid/');
    }

    console.log('✅ Manifest and assets copied to dist/');
  },
});

// Vite plugin: starts a tiny WebSocket server on port 8767 during watch mode.
// After each rebuild, sends "reload" to all connected clients (the extension's
// dev-reload module), which triggers chrome.runtime.reload().
const devReloadPlugin = () => {
  let wss: WSSType | null = null;
  const clients = new Set<WSType>();

  return {
    name: 'dev-reload',
    // Only activate in watch / dev mode
    buildStart() {
      if (!process.argv.includes('--watch')) return;
      if (wss) return; // already started

      // Dynamic import so ws is only needed in dev
      import('ws').then(({ WebSocketServer }) => {
        wss = new WebSocketServer({ port: 8767 });
        wss.on('connection', (socket) => {
          clients.add(socket);
          socket.on('close', () => clients.delete(socket));
        });
        wss.on('error', (err: NodeJS.ErrnoException) => {
          if (err.code === 'EADDRINUSE') {
            console.warn('🔄 [DevReload] Port 8767 already in use — reload server skipped (another dev instance running?)');
          } else {
            console.warn('🔄 [DevReload] WebSocket server error:', err.message);
          }
          wss = null;
        });
        console.log('🔄 [DevReload] WebSocket reload server listening on ws://127.0.0.1:8767');
      }).catch(() => {
        console.warn('🔄 [DevReload] "ws" package not installed — skipping reload server. Run: npm i -D ws @types/ws');
      });
    },
    closeBundle() {
      // After each rebuild, tell all connected extensions to reload
      if (clients.size === 0) return;
      console.log(`🔄 [DevReload] Build complete — notifying ${clients.size} client(s) to reload`);
      for (const client of clients) {
        try { client.send('reload'); } catch { /* client gone */ }
      }
    },
  };
};

export default defineConfig(({ mode }) => {
  const isDev = mode === 'development';
  return {
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    define: {
      __DEV__: JSON.stringify(isDev),
    },
    plugins: [copyManifestPlugin(), devReloadPlugin()],
    build: {
      outDir: 'dist',
      rollupOptions: {
        input: {
          background: resolve(__dirname, 'src/background/index.ts'),
          content: resolve(__dirname, 'src/content/index.ts'),
          'workers/image-processor.worker': resolve(
            __dirname,
            'src/workers/image-processor.worker.ts',
          ),
          'uuid/uuidPage': resolve(__dirname, 'src/uuid/uuidPage.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: 'assets/[name]-[hash][extname]',
        },
      },
      sourcemap: isDev,
      minify: !isDev,
      emptyOutDir: true,
    },
    worker: {
      format: 'es',
      rollupOptions: {
        output: {
          entryFileNames: '[name].js',
        },
      },
    },
  };
});
