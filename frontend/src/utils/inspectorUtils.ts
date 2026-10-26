/**
 * Engineering Inspector Utility Functions
 * Phase 9 - Task 9.6
 *
 * Pure utility functions for resolving component metadata and formatting
 * engineering labels without breaking React Fast Refresh.
 */

import type {
  EngineeringComponentMetadata,
} from '../types/engineering';
import type { EngineeringModelDefinition } from '../types/models';
import { modelRegistry } from '../models/registry';
import { PLANETARY_GEARBOX_MODEL_ID } from '../models/mechanical/planetaryGearboxModel';

/**
 * Resolves component metadata from explicit prop, active model, or model registry.
 */
export function resolveInspectorMetadata(
  metadata: EngineeringComponentMetadata | null | undefined,
  componentId: string | null | undefined,
  activeModel?: EngineeringModelDefinition | null
): EngineeringComponentMetadata | null {
  if (metadata) {
    return metadata;
  }
  if (!componentId) {
    return null;
  }

  if (activeModel) {
    if (activeModel.getComponentMetadata) {
      return activeModel.getComponentMetadata(componentId);
    }
    return null;
  }

  // Fallback to registry default model only when activeModel was omitted
  const defaultModel = modelRegistry.getModel(PLANETARY_GEARBOX_MODEL_ID);
  if (defaultModel) {
    const fromDefault = defaultModel.getComponentMetadata(componentId);
    if (fromDefault) {
      return fromDefault;
    }
  }

  return null;
}

/**
 * Formats snake_case or identifier strings to title case (e.g. 'top_chord' -> 'Top Chord')
 */
export function formatRoleTitle(text?: string | null): string {
  if (!text) return '';
  return text
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
