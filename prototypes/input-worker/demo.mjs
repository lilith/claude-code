#!/usr/bin/env node
/**
 * Demo: Input handling with buffering and delay detection
 *
 * This demonstrates the improved input handling architecture.
 * Run with: node demo.mjs
 *
 * Try:
 * 1. Type normally - should feel responsive
 * 2. Type very fast - should buffer and process without drops
 * 3. Simulate blocking with Ctrl+B - will block for 500ms to show delay detection
 */

import { InputBuffer } from './input-buffer.mjs';
import { AdaptiveRenderer } from './adaptive-renderer.mjs';
import readline from 'readline';

// Terminal setup
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

// Create components
const inputBuffer = new InputBuffer({
  delayThresholdMs: 50,
  typingModeDelayMs: 100,
  onDelayDetected: (info) => {
    console.log(`\n[DELAY] ${info.delay}ms delay detected, ${info.bufferedChars} chars buffered`);
  }
});

const renderer = new AdaptiveRenderer({
  idleThresholdMs: 50,
  maxDeferMs: 200
});

// State
let inputLine = '';
let cursorPos = 0;
let blockNext = false;

// Simulated heavy render
function heavyRender() {
  // Simulate React reconciliation work
  let x = 0;
  for (let i = 0; i < 1000000; i++) {
    x += Math.sin(i);
  }
  return x;
}

// Display function
function display() {
  process.stdout.write('\r\x1b[K'); // Clear line
  process.stdout.write(`> ${inputLine}`);

  // Show metrics periodically
  const bufferMetrics = inputBuffer.getMetrics();
  const renderMetrics = renderer.getMetrics();

  if (bufferMetrics.delayEvents > 0 || renderMetrics.deferredRenders > 0) {
    process.stdout.write(
      `  [delays: ${bufferMetrics.delayEvents}, deferred: ${renderMetrics.deferredRenders}]`
    );
  }
}

// Process input
function processInput() {
  renderer.onInput();

  const { chars, delay, count } = inputBuffer.flush();

  if (count === 0) return;

  // Simulate blocking if requested
  if (blockNext) {
    console.log('\n[BLOCKING] Simulating 500ms block...');
    const start = Date.now();
    while (Date.now() - start < 500) {
      // Busy wait
    }
    blockNext = false;
  }

  for (const char of chars) {
    if (char === '\x03') {
      // Ctrl+C
      console.log('\nExiting...');
      console.log('\nFinal Metrics:');
      console.log('  Input Buffer:', inputBuffer.getMetrics());
      console.log('  Renderer:', renderer.getMetrics());
      process.exit(0);
    } else if (char === '\x02') {
      // Ctrl+B - trigger block
      blockNext = true;
      console.log('\n[INFO] Next input will trigger 500ms block');
    } else if (char === '\x7f' || char === '\b') {
      // Backspace
      if (inputLine.length > 0) {
        inputLine = inputLine.slice(0, -1);
      }
    } else if (char === '\r' || char === '\n') {
      // Enter
      console.log(`\nYou typed: "${inputLine}"`);
      inputLine = '';
    } else if (char >= ' ' && char <= '~') {
      // Printable character
      inputLine += char;
    }
  }

  // Schedule render with adaptive priority
  renderer.requestRender(() => {
    heavyRender();
    display();
  }, { priority: 'normal' });
}

// Main input handler
process.stdin.on('data', (chunk) => {
  inputBuffer.push(chunk);

  // Use setImmediate to allow more input to buffer
  setImmediate(processInput);
});

// Initial display
console.log('Input Handling Demo');
console.log('-------------------');
console.log('Type normally or very fast to test buffering.');
console.log('Press Ctrl+B then type to simulate event loop blocking.');
console.log('Press Ctrl+C to exit and see metrics.\n');
display();
