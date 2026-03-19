import { defineConfig } from 'vite';
import { resolve } from 'path';
import { cpSync, existsSync, mkdirSync } from 'fs';

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
      { force: true }
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

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  plugins: [copyManifestPlugin()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        'workers/image-processor.worker': resolve(__dirname, 'src/workers/image-processor.worker.ts'),
        'uuid/uuidPage': resolve(__dirname, 'src/uuid/uuidPage.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
    sourcemap: process.env.NODE_ENV === 'development',
    minify: process.env.NODE_ENV === 'production',
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
});