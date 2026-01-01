/**
 * Bundle App Runtime Script
 * 
 * Compiles TypeScript files from src/app-runtime and bundles them into
 * JavaScript files using esbuild. This includes:
 * - app-preload.ts (preload script for Electron app views)
 * - backend-preload.ts (runtime for Electron utility process backends)
 */

const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

const srcDir = path.join(__dirname, '../src/app-runtime');
const distDir = path.join(__dirname, '../dist/app-runtime');

// Ensure dist directory exists
if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

async function bundle() {
    try {
        console.log('🔍 Type-checking app-runtime TypeScript files...');

        // Run TypeScript compiler for type checking (no emit)
        const { execSync } = require('child_process');
        try {
            execSync('npx tsc --noEmit -p src/app-runtime/tsconfig.json', {
                stdio: 'inherit',
                cwd: path.join(__dirname, '..')
            });
            console.log('✅ Type checking passed\n');
        } catch (error) {
            console.error('❌ Type checking failed');
            process.exit(1);
        }

        console.log('🔨 Bundling app-runtime TypeScript files...');

        // Bundle app-preload.ts (preload script for Electron app views)
        await esbuild.build({
            entryPoints: [path.join(srcDir, 'app-preload.ts')],
            bundle: true,
            outfile: path.join(distDir, 'app-preload.js'),
            format: 'cjs', // CommonJS for Electron preload scripts
            target: 'node16',
            platform: 'node',
            external: ['electron'], // Don't bundle electron
            minify: true,
            sourcemap: true,
            logLevel: 'info',
        });

        console.log('✅ app-preload.js bundled successfully');

        // Bundle backend-preload.ts (runtime for utility process backends)
        await esbuild.build({
            entryPoints: [path.join(srcDir, 'backend-preload.ts')],
            bundle: true,
            outfile: path.join(distDir, 'backend-preload.js'),
            format: 'cjs', // CommonJS for Electron utility process
            target: 'node16',
            platform: 'node',
            external: ['electron'], // Don't bundle electron
            minify: true,
            sourcemap: true,
            logLevel: 'info',
        });

        console.log('✅ backend-preload.js bundled successfully');

        console.log('🎉 App-runtime bundling complete!');
    } catch (error) {
        console.error('❌ Bundling failed:', error);
        process.exit(1);
    }
}

bundle();
