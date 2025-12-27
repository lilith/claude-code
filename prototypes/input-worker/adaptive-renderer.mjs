/**
 * AdaptiveRenderer - Defers rendering during active typing
 *
 * This wrapper around React's rendering provides:
 * 1. Render deferral during active typing
 * 2. Batched updates for multiple rapid state changes
 * 3. Priority rendering for input-related updates
 * 4. Metrics for render timing
 */

export class AdaptiveRenderer {
  constructor(options = {}) {
    // How long after last input before we resume normal rendering
    this.idleThresholdMs = options.idleThresholdMs ?? 50;

    // Maximum time to defer renders
    this.maxDeferMs = options.maxDeferMs ?? 200;

    // Minimum time between renders during typing
    this.minRenderIntervalMs = options.minRenderIntervalMs ?? 100;

    this.lastInputTime = 0;
    this.lastRenderTime = 0;
    this.deferredRender = null;
    this.renderQueue = [];
    this.isTyping = false;

    this.metrics = {
      totalRenders: 0,
      deferredRenders: 0,
      immediateRenders: 0,
      avgRenderTime: 0,
      maxRenderTime: 0
    };
  }

  /**
   * Notify that input was received
   */
  onInput() {
    this.lastInputTime = Date.now();
    this.isTyping = true;

    // Schedule end of typing mode
    if (this.typingTimeout) {
      clearTimeout(this.typingTimeout);
    }
    this.typingTimeout = setTimeout(() => {
      this.isTyping = false;
      this.flushDeferred();
    }, this.idleThresholdMs);
  }

  /**
   * Request a render
   * @param {Function} renderFn - The render function to call
   * @param {Object} options - { priority: 'high' | 'normal' | 'low' }
   */
  requestRender(renderFn, options = {}) {
    const priority = options.priority ?? 'normal';
    const now = Date.now();

    // High priority renders (input display) always execute immediately
    if (priority === 'high') {
      this.executeRender(renderFn);
      return;
    }

    // Check if we should defer
    const timeSinceInput = now - this.lastInputTime;
    const timeSinceRender = now - this.lastRenderTime;

    if (this.isTyping && timeSinceInput < this.idleThresholdMs) {
      // We're typing - defer this render
      this.deferRender(renderFn, priority);
      return;
    }

    // Not typing or idle long enough - render immediately
    this.executeRender(renderFn);
  }

  /**
   * Defer a render for later
   */
  deferRender(renderFn, priority) {
    this.renderQueue.push({ renderFn, priority, queuedAt: Date.now() });
    this.metrics.deferredRenders++;

    // Schedule flush after max defer time
    if (!this.deferredRender) {
      this.deferredRender = setTimeout(() => {
        this.flushDeferred();
      }, this.maxDeferMs);
    }
  }

  /**
   * Execute a render and track metrics
   */
  executeRender(renderFn) {
    const start = Date.now();

    try {
      renderFn();
    } finally {
      const duration = Date.now() - start;
      this.lastRenderTime = Date.now();
      this.metrics.totalRenders++;
      this.metrics.immediateRenders++;
      this.metrics.maxRenderTime = Math.max(this.metrics.maxRenderTime, duration);
      this.metrics.avgRenderTime =
        (this.metrics.avgRenderTime * (this.metrics.totalRenders - 1) + duration) /
        this.metrics.totalRenders;
    }
  }

  /**
   * Flush all deferred renders
   */
  flushDeferred() {
    if (this.deferredRender) {
      clearTimeout(this.deferredRender);
      this.deferredRender = null;
    }

    if (this.renderQueue.length === 0) return;

    // Sort by priority (high first) then by queue time
    this.renderQueue.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
      if (priorityDiff !== 0) return priorityDiff;
      return a.queuedAt - b.queuedAt;
    });

    // Execute all in order (could batch/merge for optimization)
    for (const { renderFn } of this.renderQueue) {
      this.executeRender(renderFn);
    }

    this.renderQueue = [];
  }

  /**
   * Check if rendering is currently deferred
   */
  isDeferred() {
    return this.isTyping && this.renderQueue.length > 0;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueLength: this.renderQueue.length,
      isTyping: this.isTyping
    };
  }
}

/**
 * React hook version of adaptive rendering
 *
 * Usage:
 *   const { requestRender, onInput, metrics } = useAdaptiveRenderer();
 *
 *   // In input handler
 *   onInput();
 *
 *   // When updating state that causes re-render
 *   requestRender(() => setState(newValue), { priority: 'normal' });
 */
export function createAdaptiveRendererHook(React) {
  return function useAdaptiveRenderer(options = {}) {
    const rendererRef = React.useRef(null);

    if (!rendererRef.current) {
      rendererRef.current = new AdaptiveRenderer(options);
    }

    const onInput = React.useCallback(() => {
      rendererRef.current.onInput();
    }, []);

    const requestRender = React.useCallback((renderFn, opts) => {
      rendererRef.current.requestRender(renderFn, opts);
    }, []);

    const getMetrics = React.useCallback(() => {
      return rendererRef.current.getMetrics();
    }, []);

    // Cleanup on unmount
    React.useEffect(() => {
      return () => {
        rendererRef.current.flushDeferred();
      };
    }, []);

    return { requestRender, onInput, getMetrics };
  };
}
