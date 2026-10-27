import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

// Herda plugins e aliases (`@/`) do vite.config.ts para que app e testes resolvam módulos da mesma forma.
export default mergeConfig(
    viteConfig({ command: 'serve', mode: 'test' }),
    defineConfig({
        test: {
            environment: 'jsdom',
            globals: true,
            setupFiles: ['./src/test/setupTests.ts'],
            include: ['src/**/*.test.{ts,tsx}'],
        },
    }),
);
