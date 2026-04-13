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

// Vite plugin: starts a WebSocket server on port 8767 during dev builds.
// After the build completes, waits for the extension to connect (if not
// already connected) and sends "reload" to trigger chrome.runtime.reload().
// Then exits the process so `npm run dev` is a one-shot build+reload.
const devReloadPlugin = () => {
  let wss: WSSType | null = null;
  const clients = new Set<WSType>();
  let isDev = false;

  return {
    name: 'dev-reload',
    buildStart() {
      isDev = process.env.npm_lifecycle_event === 'dev';
      if (!isDev) return;
      if (wss) return;

      import('ws')
        .then(({ WebSocketServer }) => {
          wss = new WebSocketServer({ port: 8767 });
          wss.on('connection', (socket) => {
            clients.add(socket);
            socket.on('close', () => clients.delete(socket));
          });
          wss.on('error', (err: NodeJS.ErrnoException) => {
            if (err.code === 'EADDRINUSE') {
              console.warn(
                '🔄 [DevReload] Port 8767 already in use — reload server skipped',
              );
            } else {
              console.warn(
                '🔄 [DevReload] WebSocket server error:',
                err.message,
              );
            }
            wss = null;
          });
          console.log(
            '🔄 [DevReload] WebSocket reload server listening on ws://127.0.0.1:8767',
          );
        })
        .catch(() => {
          console.warn(
            '🔄 [DevReload] "ws" package not installed — skipping. Run: npm i -D ws @types/ws',
          );
        });
    },
    closeBundle() {
      if (!isDev) return;

      const sendReloadAndExit = () => {
        if (clients.size > 0) {
          console.log(
            `🔄 [DevReload] Sending reload to ${clients.size} client(s)...`,
          );
          for (const client of clients) {
            try {
              client.send('reload');
            } catch {
              /* client gone */
            }
          }
          // Give the message time to flush, then exit
          setTimeout(() => process.exit(0), 300);
        }
      };

      // If extension is already connected, reload immediately
      if (clients.size > 0) {
        sendReloadAndExit();
        return;
      }

      // Otherwise wait for the extension to connect (up to 10s)
      console.log(
        '🔄 [DevReload] Build complete — waiting for extension to connect...',
      );
      const timeout = setTimeout(() => {
        console.warn(
          '🔄 [DevReload] No extension connected within 10s. Reload the extension manually once, then future `npm run dev` runs will auto-reload.',
        );
        process.exit(0);
      }, 10_000);

      // Check periodically if a client has connected
      const poll = setInterval(() => {
        if (clients.size > 0) {
          clearTimeout(timeout);
          clearInterval(poll);
          sendReloadAndExit();
        }
      }, 200);
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
      // Disable modulepreload polyfill — it injects __vitePreload which
      // references `document`, breaking dynamic imports in MV3 service workers.
      modulePreload: { polyfill: false },
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
