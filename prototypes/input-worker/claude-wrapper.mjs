#!/usr/bin/env node
/**
 * Claude Code Wrapper with Improved Input Handling
 *
 * This wrapper intercepts stdin, buffers it properly, and forwards
 * to the real claude CLI. This helps with:
 * - Dropped keystrokes during fast typing
 * - Remote desktop input issues
 * - Event loop blocking in the main CLI
 *
 * Usage: node claude-wrapper.mjs [claude args...]
 * Or via alias: claude2
 */

import { spawn } from 'child_process';
import { InputBuffer } from './input-buffer.mjs';

const CLAUDE_PATH = process.env.CLAUDE_PATH || 'claude';
const args = process.argv.slice(2);

// Add default flags if not in args
if (!args.includes('--dangerously-skip-permissions')) {
  // Only add if user wants it (controlled by CLAUDE2_SKIP_PERMS env var)
  if (process.env.CLAUDE2_SKIP_PERMS === '1') {
    args.unshift('--dangerously-skip-permissions');
  }
}

// Create input buffer with delay detection
const inputBuffer = new InputBuffer({
  delayThresholdMs: 100,
  typingModeDelayMs: 150,
  onDelayDetected: (info) => {
    // Could log to stderr or a file for debugging
    if (process.env.CLAUDE2_DEBUG) {
      process.stderr.write(
        `\n[claude-wrapper] Input delay: ${info.delay}ms, buffered: ${info.bufferedChars} chars\n`
      );
    }
  }
});

// Spawn the real claude
const claude = spawn(CLAUDE_PATH, args, {
  stdio: ['pipe', 'inherit', 'inherit'],
  env: process.env
});

// Set up raw mode for proper keystroke capture
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding('utf8');

// Buffer incoming input
process.stdin.on('data', (chunk) => {
  inputBuffer.push(chunk);
});

// Forward buffered input to claude at regular intervals
// This decouples input capture from claude's processing speed
const forwardInterval = setInterval(() => {
  if (inputBuffer.size() > 0) {
    const { chars } = inputBuffer.flush();
    if (chars && claude.stdin.writable) {
      claude.stdin.write(chars);
    }
  }
}, 10); // 10ms = 100Hz, fast enough for typing

// Handle claude exit
claude.on('close', (code) => {
  clearInterval(forwardInterval);

  // Flush any remaining input
  const { chars } = inputBuffer.flush();
  if (chars && claude.stdin.writable) {
    claude.stdin.write(chars);
  }

  // Show metrics if debugging
  if (process.env.CLAUDE2_DEBUG) {
    const metrics = inputBuffer.getMetrics();
    process.stderr.write(`\n[claude-wrapper] Session metrics:\n`);
    process.stderr.write(`  Total inputs: ${metrics.totalInputs}\n`);
    process.stderr.write(`  Delay events: ${metrics.delayEvents}\n`);
    process.stderr.write(`  Max delay: ${metrics.maxDelay}ms\n`);
  }

  process.exit(code ?? 0);
});

// Handle wrapper exit signals
process.on('SIGINT', () => {
  claude.kill('SIGINT');
});

process.on('SIGTERM', () => {
  claude.kill('SIGTERM');
});
