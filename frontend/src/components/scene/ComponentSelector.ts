/**
 * ComponentSelector & Dwell Confirmation Engine
 * Task 5.2: Selection Confirmation & Dwell Mechanism
 *
 * Implements dwell time confirmation (1.2s dwell threshold) for gesture pointing
 * and immediate selection for mouse click, with clean state transitions.
 */

export interface ComponentSelectorConfig {
  /** Dwell duration in milliseconds required to confirm selection while hovering (default 1200ms) */
  dwellDurationMs: number;
}

export const DEFAULT_SELECTOR_CONFIG: ComponentSelectorConfig = {
  dwellDurationMs: 1200,
};

export interface ComponentSelectorUpdateResult {
  /** The actively locked selected component ID, or null if none */
  selectedId: string | null;
  /** The currently hovered component ID, or null if hovering empty space */
  hoveredId: string | null;
  /** Dwell timer progress normalized from 0.0 to 1.0 */
  dwellProgress: number;
  /** True in the single update frame when a component locks as selected */
  justSelected: boolean;
  /** True in the single update frame when selection was cleared */
  justDeselected: boolean;
}

/**
 * Pure state machine managing dwell timers, hover states, and component selection.
 * Decoupled from rendering logic for independent unit testing.
 */
export class ComponentSelector {
  private config: ComponentSelectorConfig;
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private dwellTimerMs: number = 0;
  private dwellProgress: number = 0;

  constructor(config: Partial<ComponentSelectorConfig> = {}) {
    this.config = { ...DEFAULT_SELECTOR_CONFIG, ...config };
  }

  public getConfig(): ComponentSelectorConfig {
    return { ...this.config };
  }

  public setConfig(partialConfig: Partial<ComponentSelectorConfig>): void {
    this.config = { ...this.config, ...partialConfig };
  }

  /**
   * Advances the dwell timer by deltaMs based on the currently hovered component.
   *
   * @param candidateHoverId - Component ID currently under cursor, or null if empty space
   * @param deltaMs - Elapsed frame time in milliseconds
   */
  public update(
    candidateHoverId: string | null,
    deltaMs: number
  ): ComponentSelectorUpdateResult {
    let justSelected = false;

    // 1. Target changed: reset dwell timer
    if (candidateHoverId !== this.hoveredId) {
      this.hoveredId = candidateHoverId;
      this.dwellTimerMs = 0;
      this.dwellProgress = 0;
    }

    // 2. Hovering over an unselected component: advance dwell progress
    if (this.hoveredId !== null && this.hoveredId !== this.selectedId) {
      this.dwellTimerMs += Math.max(0, deltaMs);
      this.dwellProgress = Math.min(1.0, this.dwellTimerMs / this.config.dwellDurationMs);

      // 3. Dwell threshold reached: confirm selection
      if (this.dwellProgress >= 1.0) {
        this.selectedId = this.hoveredId;
        this.dwellTimerMs = 0;
        this.dwellProgress = 0;
        justSelected = true;
      }
    } else {
      // Hovering empty space or hovering the already-selected component
      this.dwellTimerMs = 0;
      this.dwellProgress = 0;
    }

    return {
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      dwellProgress: this.dwellProgress,
      justSelected,
      justDeselected: false,
    };
  }

  /**
   * Direct selection (e.g. mouse click).
   */
  public select(componentId: string | null): ComponentSelectorUpdateResult {
    const prevSelected = this.selectedId;
    this.selectedId = componentId;
    this.dwellTimerMs = 0;
    this.dwellProgress = 0;

    return {
      selectedId: this.selectedId,
      hoveredId: this.hoveredId,
      dwellProgress: 0,
      justSelected: componentId !== null && componentId !== prevSelected,
      justDeselected: componentId === null && prevSelected !== null,
    };
  }

  /**
   * Clears the current active selection.
   */
  public clearSelection(): ComponentSelectorUpdateResult {
    return this.select(null);
  }

  public getSelectedId(): string | null {
    return this.selectedId;
  }

  public getHoveredId(): string | null {
    return this.hoveredId;
  }

  public getDwellProgress(): number {
    return this.dwellProgress;
  }

  public reset(): void {
    this.hoveredId = null;
    this.selectedId = null;
    this.dwellTimerMs = 0;
    this.dwellProgress = 0;
  }
}

export default ComponentSelector;
