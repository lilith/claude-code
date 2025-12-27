/**
 * Input Worker - Runs in a separate thread to capture stdin
 *
 * This worker captures all stdin input and forwards it to the main thread
 * via MessagePort. This ensures input capture is never blocked by:
 * - React rendering
 * - GC pauses in main thread
 * - Heavy computation
 *
 * Usage:
 *   const worker = new Worker('./input-worker.mjs');
 *   worker.on('message', (msg) => {
 *     if (msg.type === 'input') handleInput(msg.data, msg.timestamp);
 *     if (msg.type === 'delay_warning') console.warn(msg.message);
 *   });
 */

import { parentPort, workerData } from 'worker_threads';

const DELAY_WARNING_THRESHOLD_MS = 50;

let lastInputTime = 0;
let inputBuffer = [];
let flushTimeout = null;

// Configure stdin in raw mode
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
}
process.stdin.resume();
process.stdin.setEncoding('utf8');

/**
 * Flush buffered input to main thread
 */
function flushBuffer() {
  if (inputBuffer.length === 0) return;

  const now = Date.now();
  const batch = {
    type: 'input_batch',
    inputs: inputBuffer,
    batchTimestamp: now
  };

  parentPort.postMessage(batch);
  inputBuffer = [];
  flushTimeout = null;
}

/**
 * Schedule a buffer flush
 * We batch inputs that arrive within 5ms of each other
 * This reduces message passing overhead while maintaining responsiveness
 */
function scheduleFlush() {
  if (flushTimeout === null) {
    flushTimeout = setTimeout(flushBuffer, 5);
  }
}

/**
 * Handle incoming stdin data
 */
process.stdin.on('data', (chunk) => {
  const now = Date.now();

  // Check for processing delays (indicates main thread was blocked)
  if (lastInputTime > 0) {
    const gap = now - lastInputTime;
    if (gap > DELAY_WARNING_THRESHOLD_MS && inputBuffer.length > 0) {
      parentPort.postMessage({
        type: 'delay_warning',
        gap,
        message: `Input processing delayed by ${gap}ms (${inputBuffer.length} chars buffered)`
      });
    }
  }

  // Buffer each character with timestamp
  for (const char of chunk) {
    inputBuffer.push({
      char,
      timestamp: now,
      sequence: chunk.length > 1 // Part of escape sequence
    });
  }

  lastInputTime = now;
  scheduleFlush();
});

// Handle worker shutdown
parentPort.on('message', (msg) => {
  if (msg.type === 'shutdown') {
    flushBuffer();
    process.stdin.pause();
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.exit(0);
  }
});

// Signal ready
parentPort.postMessage({ type: 'ready' });
