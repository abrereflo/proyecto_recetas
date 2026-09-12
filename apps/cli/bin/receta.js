#!/usr/bin/env node
// Entry point for the `receta` binary.
//
// No package in this workspace emits JavaScript (see tsconfig.base.json), so
// the CLI runs straight from TypeScript sources through tsx.
import { tsImport } from 'tsx/esm/api';

await tsImport('../src/main.ts', import.meta.url);
