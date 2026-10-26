/**
 * Engineering Explorer Dashboard Utilities
 * Phase 9 - Task 9.7: Engineering Explorer Home Dashboard & Model Catalogue
 *
 * Pure filtering and statistics functions for model discovery without breaking
 * React Fast Refresh compliance.
 */

import type { EngineeringModelDefinition } from '../types/models';
import type { EngineeringDomain } from '../types/engineering';

export type DomainFilterType = 'all' | EngineeringDomain | 'medical';

/**
 * Counts models across all domains
 */
export function getDomainCounts(models: EngineeringModelDefinition[]): {
  all: number;
  mechanical: number;
  civil: number;
  medical: number;
} {
  let mechanical = 0;
  let civil = 0;
  let medical = 0;

  for (const model of models) {
    if (model.domain === 'mechanical') {
      mechanical += 1;
    } else if (model.domain === 'civil') {
      civil += 1;
    } else if ((model as unknown as { domain: string }).domain === 'medical') {
      medical += 1;
    }
  }

  return {
    all: models.length,
    mechanical,
    civil,
    medical,
  };
}

/**
 * Filters models using combined domain and case-insensitive search queries.
 * Matches against model name, description, category, and keyword tags.
 */
export function filterModels(
  models: EngineeringModelDefinition[],
  domain: DomainFilterType,
  searchQuery: string
): EngineeringModelDefinition[] {
  const query = searchQuery.toLowerCase().trim();

  return models.filter((model) => {
    // 1. Domain Match
    if (domain !== 'all' && model.domain !== domain) {
      return false;
    }

    // 2. Search Query Match
    if (query === '') {
      return true;
    }

    const nameMatch = model.name.toLowerCase().includes(query);
    const descMatch = model.description.toLowerCase().includes(query);
    const catMatch = model.category.toLowerCase().includes(query);
    const tagMatch = model.tags.some((tag) => tag.toLowerCase().includes(query));

    return nameMatch || descMatch || catMatch || tagMatch;
  });
}
