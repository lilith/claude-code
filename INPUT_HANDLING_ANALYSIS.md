# Claude Code Input Handling Analysis

## Executive Summary

Investigation of keystroke dropping issues in Claude Code CLI, particularly during:
- Fast typing
- Remote desktop usage
- Low memory conditions

## Architecture Overview

Claude Code uses **Ink** (React for terminal UIs) built on:
- Node.js stdin streams in raw mode
- React reconciliation for UI updates
- Internal event emitter for input propagation

### Input Flow

```
stdin (raw mode)
    ↓
handleReadable() - reads all available chunks in a while loop
    ↓
handleInput() - processes Ctrl+C, Escape, Tab
    ↓
internal_eventEmitter.emit('input', chunk)
    ↓
useInput() hook - parses keypress, calls user callbacks
    ↓
React state updates → re-render
```

## Identified Issues

### 1. Event Loop Blocking

**Problem**: React rendering and stdin handling share the same event loop.

```
[Event Loop Tick]
├── stdin readable event
├── handleReadable() - synchronous
├── React reconciliation - can be heavy
└── stdout.write() - synchronous
```

When rendering is slow (syntax highlighting, large outputs), the event loop can't process stdin events promptly.

**Evidence**:
- 1,193+ update operations per session
- 634+ render calls
- Complex UI with multiple components

### 2. Remote Desktop Latency Amplification

**Problem**: Remote desktop protocols (RDP, VNC) batch keystrokes.

When keystrokes arrive in bursts:
1. Multiple keys arrive in single `readable` event
2. Each key triggers React re-render
3. Renders block processing of subsequent keys
4. Buffer overflow can occur at OS level

### 3. Memory Pressure GC Pauses

**Problem**: Low memory causes GC pauses that block the event loop.

During GC:
- stdin events queue up
- OS-level terminal buffers can overflow
- No input processing for 10-100ms+

### 4. Throttle/Debounce in Output

**Evidence from codebase**:
- 42 instances of `throttle`
- 20 instances of `debounce`
- Output written in 2000-char chunks

These are applied to OUTPUT, not input, but heavy output can still block input handling.

## Proposed Improvements

### Option A: Input Worker Thread (Recommended)

Separate input handling from main event loop:

```javascript
// worker-input.js
const { parentPort } = require('worker_threads');

process.stdin.setRawMode(true);
process.stdin.on('readable', () => {
  let chunk;
  while ((chunk = process.stdin.read()) !== null) {
    // Buffer keystrokes with timestamps
    parentPort.postMessage({
      type: 'input',
      data: chunk,
      timestamp: Date.now()
    });
  }
});

// Main thread receives via MessagePort - never blocks input
```

**Benefits**:
- Input capture is never blocked by rendering
- GC in main thread doesn't affect input capture
- Can detect and report delays between capture and processing

### Option B: Input Buffer with Delay Detection

Add buffering layer with timing information:

```javascript
class InputBuffer {
  private buffer: Array<{char: string, timestamp: number}> = [];
  private lastFlush = Date.now();

  push(data: string) {
    const now = Date.now();
    for (const char of data) {
      this.buffer.push({ char, timestamp: now });
    }
  }

  flush(): { chars: string, delay: number } {
    const now = Date.now();
    const delay = now - this.lastFlush;
    const chars = this.buffer.map(b => b.char).join('');

    // Report if event loop was blocked
    if (delay > 100) {
      console.warn(`[Input] Event loop blocked for ${delay}ms`);
    }

    this.buffer = [];
    this.lastFlush = now;
    return { chars, delay };
  }
}
```

### Option C: Two-Mode Input Handling

Implement "typing mode" vs "command mode":

```javascript
// Typing mode: minimal processing, maximum responsiveness
if (isTypingMode) {
  // Just buffer characters, defer all processing
  inputBuffer.push(chunk);
  return;
}

// Command mode: full processing for shortcuts
handleInput(chunk);
```

**User sees**:
- Fast, responsive text input
- Brief visual indicator when processing catches up
- Shortcuts still work but with slight delay during heavy typing

### Option D: Rendering Throttle Based on Input

Defer re-renders while user is actively typing:

```javascript
const INPUT_IDLE_THRESHOLD = 50; // ms

function shouldDeferRender() {
  const timeSinceLastInput = Date.now() - lastInputTimestamp;
  return timeSinceLastInput < INPUT_IDLE_THRESHOLD;
}

// In render loop
if (shouldDeferRender()) {
  scheduleRenderAfterIdle();
  return;
}
```

## Implementation Recommendations

### Phase 1: Instrumentation (Quick Win)

Add telemetry to understand the problem:

```javascript
let lastInputTime = 0;

function handleReadable() {
  const now = Date.now();
  const gap = lastInputTime ? now - lastInputTime : 0;

  if (gap > 50) {
    // Log to telemetry: potential keystroke processing delay
    logInputDelay(gap);
  }

  lastInputTime = now;
  // ... existing handling
}
```

### Phase 2: Input Worker (Medium Effort)

Implement Option A with fallback:

1. Create input worker thread
2. Forward all stdin to worker
3. Worker buffers and forwards to main via MessagePort
4. Main thread processes at its own pace
5. Fallback to direct stdin if workers unavailable

### Phase 3: Adaptive Rendering (Complex)

Implement render deferral:

1. Track input frequency
2. When typing fast, defer non-critical renders
3. Batch render updates
4. Show typing indicator if processing lags

## Testing Strategy

### Simulate Dropped Keystrokes

```bash
# Generate rapid keystrokes
echo "abcdefghijklmnopqrstuvwxyz" | pv -qL 1000 | nc -U /tmp/claude.sock

# Or use expect/pty:
expect -c '
  spawn claude
  sleep 1
  send "The quick brown fox jumps over the lazy dog"
  sleep 2
  send "\r"
'
```

### Measure Input Latency

```javascript
// Inject into handleReadable
const inputStart = process.hrtime.bigint();
// ... handle input
const inputEnd = process.hrtime.bigint();
const latencyNs = inputEnd - inputStart;
```

### Remote Desktop Testing

1. Use RDP/VNC to connect
2. Type rapidly in Claude Code
3. Compare input vs displayed characters
4. Log any mismatches

## References

- [Ink GitHub](https://github.com/vadimdemedes/ink)
- [Ink useInput hook](https://github.com/vadimdemedes/ink/blob/master/src/hooks/use-input.ts)
- [Node.js Worker Threads](https://nodejs.org/api/worker_threads.html)
- [Ink Issue #625](https://github.com/vadimdemedes/ink/issues/625) - Input handling regression

## Next Steps

1. File issue on claude-code repo with this analysis
2. Prototype Option A (worker thread) in a branch
3. Add input latency instrumentation
4. Test with remote desktop scenarios
