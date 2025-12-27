#!/usr/bin/env node
/**
 * Stress test for input handling
 *
 * This script generates rapid input and measures:
 * - Character drops
 * - Processing delays
 * - Buffer behavior
 *
 * Run with: node stress-test.mjs
 */

import { InputBuffer } from './input-buffer.mjs';
import { spawn } from 'child_process';

const TEST_STRING = 'The quick brown fox jumps over the lazy dog. ';
const REPEAT_COUNT = 10;
const INPUT_DELAY_MS = 5; // 200 chars/second

console.log('Input Handling Stress Test');
console.log('==========================\n');

// Test 1: Buffer behavior under load
async function testBufferBehavior() {
  console.log('Test 1: Buffer behavior under simulated load');
  console.log('---------------------------------------------');

  const buffer = new InputBuffer({
    delayThresholdMs: 20,
    onDelayDetected: (info) => {
      console.log(`  Delay detected: ${info.delay}ms (${info.bufferedChars} chars)`);
    }
  });

  const fullInput = TEST_STRING.repeat(REPEAT_COUNT);
  let processedChars = '';
  let flushCount = 0;

  // Simulate rapid input with occasional processing delays
  for (let i = 0; i < fullInput.length; i++) {
    buffer.push(fullInput[i]);

    // Simulate event loop blocking every 50 chars
    if (i % 50 === 0 && i > 0) {
      await new Promise(r => setTimeout(r, 30)); // Simulate 30ms block
    }

    // Process every 10 chars
    if (i % 10 === 0) {
      const { chars } = buffer.flush();
      processedChars += chars;
      flushCount++;
    }
  }

  // Final flush
  const { chars } = buffer.flush();
  processedChars += chars;
  flushCount++;

  const metrics = buffer.getMetrics();

  console.log(`  Input length: ${fullInput.length}`);
  console.log(`  Processed length: ${processedChars.length}`);
  console.log(`  Characters match: ${fullInput === processedChars}`);
  console.log(`  Flush count: ${flushCount}`);
  console.log(`  Delay events: ${metrics.delayEvents}`);
  console.log(`  Max delay: ${metrics.maxDelay}ms`);
  console.log();
}

// Test 2: Typing mode detection
async function testTypingMode() {
  console.log('Test 2: Typing mode detection');
  console.log('-----------------------------');

  const buffer = new InputBuffer({
    typingModeDelayMs: 50
  });

  // Rapid typing
  for (let i = 0; i < 20; i++) {
    buffer.push('a');
    await new Promise(r => setTimeout(r, 10));
    console.log(`  After char ${i + 1}: isTyping = ${buffer.isTyping()}`);
  }

  // Wait for typing mode to end
  await new Promise(r => setTimeout(r, 100));
  console.log(`  After 100ms pause: isTyping = ${buffer.isTyping()}`);
  console.log();
}

// Test 3: Queue time tracking
async function testQueueTime() {
  console.log('Test 3: Queue time tracking');
  console.log('---------------------------');

  const buffer = new InputBuffer();

  // Add some chars
  buffer.push('abc');

  // Wait before processing
  await new Promise(r => setTimeout(r, 50));

  const result = buffer.flush();

  console.log(`  Characters: "${result.chars}"`);
  console.log(`  Avg queue time: ${result.avgQueueTime.toFixed(2)}ms`);
  console.log(`  Expected: ~50ms (actual processing delay)`);
  console.log();
}

// Test 4: Compare with/without buffering
async function testComparison() {
  console.log('Test 4: Simulated event loop blocking comparison');
  console.log('------------------------------------------------');

  const fullInput = TEST_STRING.repeat(5);

  // Scenario A: Without buffering (direct processing)
  let directDropped = 0;
  let directProcessed = '';
  let isBlocked = false;

  const directStart = Date.now();

  for (let i = 0; i < fullInput.length; i++) {
    const char = fullInput[i];

    // Simulate event loop block every 20 chars
    if (i % 20 === 0 && i > 0) {
      isBlocked = true;
      await new Promise(r => setTimeout(r, 25));
      isBlocked = false;
    }

    // In real scenario, chars arriving during block would be lost
    // We simulate this by "dropping" chars that arrive during block
    if (isBlocked) {
      directDropped++;
    } else {
      directProcessed += char;
    }
  }

  const directTime = Date.now() - directStart;

  // Scenario B: With buffering
  const buffer = new InputBuffer();
  let bufferedProcessed = '';

  const bufferedStart = Date.now();

  for (let i = 0; i < fullInput.length; i++) {
    buffer.push(fullInput[i]);

    // Same blocking pattern
    if (i % 20 === 0 && i > 0) {
      await new Promise(r => setTimeout(r, 25));
    }

    // Process less frequently (simulating render-blocked main thread)
    if (i % 20 === 0) {
      const { chars } = buffer.flush();
      bufferedProcessed += chars;
    }
  }

  // Final flush
  bufferedProcessed += buffer.flush().chars;

  const bufferedTime = Date.now() - bufferedStart;

  console.log('  Without buffering:');
  console.log(`    Processed: ${directProcessed.length}/${fullInput.length} chars`);
  console.log(`    Dropped: ${directDropped} chars`);
  console.log(`    Time: ${directTime}ms`);
  console.log();
  console.log('  With buffering:');
  console.log(`    Processed: ${bufferedProcessed.length}/${fullInput.length} chars`);
  console.log(`    Dropped: ${fullInput.length - bufferedProcessed.length} chars`);
  console.log(`    Time: ${bufferedTime}ms`);
  console.log(`    Delay events: ${buffer.getMetrics().delayEvents}`);
  console.log();
}

// Run all tests
async function runTests() {
  await testBufferBehavior();
  await testTypingMode();
  await testQueueTime();
  await testComparison();

  console.log('All tests completed!');
}

runTests().catch(console.error);
