#!/usr/bin/env bun
import server from './server';

console.log('Starting backend server...');
console.log(`Server will run on http://localhost:${server.port}`);
console.log('Available routes:');
console.log('  GET  / - Health check');
console.log('  POST /api/trpc/* - tRPC endpoints');

// @ts-ignore - Bun global
Bun.serve(server);