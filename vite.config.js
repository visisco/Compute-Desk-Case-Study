import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Single-file build so dist/index.html can be opened directly or shared as one file.
export default defineConfig({ plugins: [react(), viteSingleFile()] })
