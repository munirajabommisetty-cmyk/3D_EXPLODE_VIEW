/**
 * Engineering Model Registry
 * Phase 9 - Task 9.2: Modular Model Registry & Planetary Gearbox Refactor
 *
 * Centralized, typed registry for registering, discovering, and retrieving
 * 3D engineering models across Mechanical and Civil disciplines.
 */

import type {
  EngineeringModelDefinition,
} from '../types/models';
import type {
  EngineeringDomain,
} from '../types/engineering';
import { planetaryGearboxModel } from './mechanical/planetaryGearboxModel';
import { warrenTrussBridgeModel } from './civil/warrenTrussBridgeModel';

export class ModelRegistryService {
  private models: Map<string, EngineeringModelDefinition> = new Map();

  /**
   * Registers an engineering model definition.
   * Deliberately handles duplicate registrations:
   * - If the exact same model object is registered again, it succeeds idempotently.
   * - If a different model definition attempts to register with an existing ID, throws an Error.
   *
   * @param model Model definition adhering to EngineeringModelDefinition
   * @throws Error if a different model with the same ID is already registered
   */
  public register(model: EngineeringModelDefinition): void {
    if (!model || typeof model.id !== 'string' || model.id.trim() === '') {
      throw new Error('Cannot register model: model must have a valid non-empty string ID.');
    }

    if (this.models.has(model.id)) {
      const existing = this.models.get(model.id);
      if (existing === model) {
        // Idempotent re-registration of identical reference
        return;
      }
      throw new Error(
        `Duplicate model registration rejected: Model with ID "${model.id}" is already registered ("${existing?.name}"). Cannot overwrite with "${model.name}".`
      );
    }

    this.models.set(model.id, model);
  }

  /**
   * Retrieves a registered model by its unique ID
   */
  public getModel(id: string): EngineeringModelDefinition | undefined {
    return this.models.get(id);
  }

  /**
   * Checks whether a model with the specified ID is currently registered
   */
  public hasModel(id: string): boolean {
    return this.models.has(id);
  }

  /**
   * Returns all registered engineering models
   */
  public getAllModels(): EngineeringModelDefinition[] {
    return Array.from(this.models.values());
  }

  /**
   * Returns all models belonging to a specific engineering domain ('mechanical' | 'civil')
   */
  public getModelsByDomain(domain: EngineeringDomain): EngineeringModelDefinition[] {
    return this.getAllModels().filter((model) => model.domain === domain);
  }

  /**
   * Unregisters a model by ID.
   * Returns true if the model was found and removed, false otherwise.
   */
  public unregister(id: string): boolean {
    return this.models.delete(id);
  }

  /**
   * Removes all registered models from the registry
   */
  public clear(): void {
    this.models.clear();
  }

  /**
   * Re-initializes default models (planetary gearbox, warren truss bridge)
   */
  public resetToDefaults(): void {
    this.clear();
    this.register(planetaryGearboxModel);
    this.register(warrenTrussBridgeModel);
  }
}

/**
 * Singleton instance of the Engineering Model Registry,
 * pre-populated with default models.
 */
export const modelRegistry = new ModelRegistryService();
modelRegistry.register(planetaryGearboxModel);
modelRegistry.register(warrenTrussBridgeModel);

// Export uppercase alias for architectural convenience
export const ModelRegistry = modelRegistry;
