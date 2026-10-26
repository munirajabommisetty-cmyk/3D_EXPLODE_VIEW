/**
 * Engineering Domain & Component Metadata Schemas
 * Phase 9 - Task 9.1: Polymorphic Engineering Domain Schemas & Model Contracts
 *
 * Defines decoupled, strictly-typed schemas for common component metadata
 * and optional domain-specific extensions (mechanical & civil), supported by
 * deterministic runtime type guards.
 */

export type EngineeringDomain = 'mechanical' | 'civil';

/**
 * Common engineering specification entry (key-value pair)
 */
export interface ComponentSpecification {
  label: string;
  value: string;
}

/**
 * Expresses an explicit physical, kinematic, structural, or anatomical relationship
 * between components in an assembly.
 */
export interface ComponentRelationship {
  /** Identifier of the target component in the same model assembly */
  targetComponentId: string;
  /**
   * The nature of the physical coupling or interaction.
   * Extensible union supporting mechanical kinematics, civil structural load paths,
   * and medical anatomical attachments.
   */
  relationshipType:
    | 'drives'
    | 'driven_by'
    | 'mates_with'
    | 'supports'
    | 'supported_by'
    | 'articulates_with'
    | 'encloses'
    | 'enclosed_by'
    | 'fastened_to'
    | string;
  /** Optional concise explanation of the interaction or functional coupling */
  description?: string;
}

/**
 * Functional classification of a component within its overall system/assembly.
 */
export type AssemblyRoleClassification =
  | 'prime_mover'
  | 'power_transmission'
  | 'structural_framing'
  | 'connection_joint'
  | 'containment_closure'
  | 'fluid_gas_flow'
  | 'electrical_ignition'
  | 'bearing_support'
  | string;

/**
 * Base metadata shared by all engineering components regardless of discipline
 */
export interface BaseComponentMetadata {
  id: string;
  name: string;
  domain: EngineeringDomain;
  role: string;
  materialName: string;
  description: string;
  specifications: ComponentSpecification[];
  engineeringNotes: string[];
  /** Optional explicit relationships to other components in the assembly */
  relationships?: ComponentRelationship[];
  /** Optional standardized functional role classification within the assembly */
  assemblyRole?: AssemblyRoleClassification;
}

/**
 * Mechanical engineering metadata extension.
 * All domain-specific properties are strictly optional/nullable.
 */
export interface MechanicalComponentMetadata extends BaseComponentMetadata {
  domain: 'mechanical';
  nominalRpm?: string;
  gearRatio?: string;
  teethCount?: number;
  pitchDiameter?: string;
  modulePitch?: string;
  lubricationSpec?: string;
  serviceIntervalHours?: number;
  torqueRating?: string;
}

/**
 * Civil engineering metadata extension.
 * All domain-specific properties are optional educational annotations.
 * NOTE: These are qualitative educational specs, NOT live simulated FEA or calculated values.
 */
export interface CivilComponentMetadata extends BaseComponentMetadata {
  domain: 'civil';
  structuralRole?:
    | 'top_chord'
    | 'bottom_chord'
    | 'vertical_strut'
    | 'diagonal_member'
    | 'gusset_plate'
    | 'pier'
    | 'deck'
    | 'cable'
    | string;
  nominalForceType?:
    | 'compression'
    | 'tension'
    | 'bending'
    | 'shear'
    | 'combined'
    | string;
  designLoadAnnotation?: string;
  materialGrade?: string;
  spanLength?: string;
  slendernessAnnotation?: string;
  educationalNotes?: string[];
}

/**
 * Polymorphic union of all domain component metadata types
 */
export type EngineeringComponentMetadata =
  | MechanicalComponentMetadata
  | CivilComponentMetadata;

/* ========================================================================= */
/*                              Type Guards                                  */
/* ========================================================================= */

/**
 * Safe type guard for BaseComponentMetadata
 */
export function isBaseComponentMetadata(value: unknown): value is BaseComponentMetadata {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.name === 'string' &&
    (candidate.domain === 'mechanical' || candidate.domain === 'civil') &&
    typeof candidate.role === 'string' &&
    typeof candidate.materialName === 'string' &&
    typeof candidate.description === 'string' &&
    Array.isArray(candidate.specifications) &&
    Array.isArray(candidate.engineeringNotes)
  );
}

/**
 * Safe type guard for MechanicalComponentMetadata
 */
export function isMechanicalMetadata(value: unknown): value is MechanicalComponentMetadata {
  if (!isBaseComponentMetadata(value)) {
    return false;
  }
  return value.domain === 'mechanical';
}

/**
 * Safe type guard for CivilComponentMetadata
 */
export function isCivilMetadata(value: unknown): value is CivilComponentMetadata {
  if (!isBaseComponentMetadata(value)) {
    return false;
  }
  return value.domain === 'civil';
}

export interface RelationshipValidationResult {
  isValid: boolean;
  errors: string[];
}

/**
 * Validates that all relationship references in a component metadata object
 * point to valid, non-self component IDs within the specified model's known components.
 */
export function validateComponentRelationships(
  metadata: BaseComponentMetadata,
  validComponentIds: ReadonlySet<string> | readonly string[]
): RelationshipValidationResult {
  const errors: string[] = [];
  const validSet =
    validComponentIds instanceof Set ? validComponentIds : new Set(validComponentIds);

  if (!metadata.relationships || metadata.relationships.length === 0) {
    return { isValid: true, errors: [] };
  }

  for (const rel of metadata.relationships) {
    if (!rel.targetComponentId || typeof rel.targetComponentId !== 'string') {
      errors.push(
        `Component "${metadata.id}" has a relationship with an invalid or empty targetComponentId.`
      );
      continue;
    }

    if (rel.targetComponentId === metadata.id) {
      errors.push(`Component "${metadata.id}" cannot have a relationship targeting itself.`);
    }

    if (!validSet.has(rel.targetComponentId)) {
      errors.push(
        `Component "${metadata.id}" references unknown targetComponentId "${rel.targetComponentId}". Target does not exist in model.`
      );
    }

    if (
      !rel.relationshipType ||
      typeof rel.relationshipType !== 'string' ||
      rel.relationshipType.trim() === ''
    ) {
      errors.push(
        `Component "${metadata.id}" relationship to "${rel.targetComponentId}" missing relationshipType.`
      );
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}
