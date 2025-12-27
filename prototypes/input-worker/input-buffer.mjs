/**
 * InputBuffer - High-performance input buffering with delay detection
 *
 * This class provides:
 * 1. Buffering of incoming keystrokes with timestamps
 * 2. Detection of event loop blocking
 * 3. Metrics for input latency
 * 4. Two-mode operation (typing vs command mode)
 */

export class InputBuffer {
  constructor(options = {}) {
    this.buffer = [];
    this.lastProcessTime = Date.now();
    this.delayThresholdMs = options.delayThresholdMs ?? 50;
    this.onDelayDetected = options.onDelayDetected ?? (() => {});
    this.metrics = {
      totalInputs: 0,
      delayEvents: 0,
      maxDelay: 0,
      avgProcessingTime: 0,
      totalProcessingTime: 0
    };

    // Two-mode tracking
    this.typingMode = false;
    this.lastInputTime = 0;
    this.typingModeTimeout = null;
    this.typingModeDelayMs = options.typingModeDelayMs ?? 100;
  }

  /**
   * Push input data with timestamp
   */
  push(data, timestamp = Date.now()) {
    const chars = typeof data === 'string' ? data.split('') : [data];

    for (const char of chars) {
      this.buffer.push({
        char,
        receivedAt: timestamp,
        queuedAt: Date.now()
      });
    }

    this.lastInputTime = Date.now();
    this.metrics.totalInputs += chars.length;

    // Enter typing mode
    if (!this.typingMode) {
      this.typingMode = true;
    }

    // Reset typing mode timeout
    if (this.typingModeTimeout) {
      clearTimeout(this.typingModeTimeout);
    }
    this.typingModeTimeout = setTimeout(() => {
      this.typingMode = false;
    }, this.typingModeDelayMs);
  }

  /**
   * Push a batch of inputs (from worker thread)
   */
  pushBatch(inputs) {
    for (const input of inputs) {
      this.push(input.char, input.timestamp);
    }
  }

  /**
   * Check if we're in active typing mode
   */
  isTyping() {
    return this.typingMode;
  }

  /**
   * Get number of pending characters
   */
  size() {
    return this.buffer.length;
  }

  /**
   * Flush all buffered input
   * Returns { chars, delay, dropped }
   */
  flush() {
    const now = Date.now();
    const processStart = now;

    // Calculate delay since last flush
    const delay = now - this.lastProcessTime;

    if (delay > this.delayThresholdMs && this.buffer.length > 0) {
      this.metrics.delayEvents++;
      this.metrics.maxDelay = Math.max(this.metrics.maxDelay, delay);
      this.onDelayDetected({
        delay,
        bufferedChars: this.buffer.length,
        timestamp: now
      });
    }

    // Extract characters
    const chars = this.buffer.map(b => b.char).join('');

    // Calculate queue times
    const queueTimes = this.buffer.map(b => b.queuedAt - b.receivedAt);
    const avgQueueTime = queueTimes.length > 0
      ? queueTimes.reduce((a, b) => a + b, 0) / queueTimes.length
      : 0;

    // Clear buffer
    this.buffer = [];
    this.lastProcessTime = now;

    // Update metrics
    const processingTime = Date.now() - processStart;
    this.metrics.totalProcessingTime += processingTime;
    this.metrics.avgProcessingTime =
      this.metrics.totalProcessingTime / this.metrics.totalInputs || 0;

    return {
      chars,
      delay,
      avgQueueTime,
      count: chars.length
    };
  }

  /**
   * Peek at buffered content without flushing
   */
  peek() {
    return this.buffer.map(b => b.char).join('');
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return { ...this.metrics };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalInputs: 0,
      delayEvents: 0,
      maxDelay: 0,
      avgProcessingTime: 0,
      totalProcessingTime: 0
    };
  }
}
