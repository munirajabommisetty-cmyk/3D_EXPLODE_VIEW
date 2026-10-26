/**
 * Assembly Hierarchy Tree Utilities
 * Phase 9 - Task 9.5
 *
 * Provides pure functional algorithms for traversing, filtering,
 * and querying CAD AssemblyTreeNode hierarchies.
 */

import type { AssemblyTreeNode } from '../types/models';

/**
 * Collects all descendant leaf component IDs under an assembly tree node.
 */
export function getDescendantComponentIds(node: AssemblyTreeNode): string[] {
  const ids: string[] = [];
  function recurse(n: AssemblyTreeNode) {
    if (n.componentId) {
      ids.push(n.componentId);
    }
    if (n.children && n.children.length > 0) {
      for (const child of n.children) {
        recurse(child);
      }
    }
  }
  recurse(node);
  return ids;
}

/**
 * Finds all ancestor node IDs leading from the root down to a target component ID.
 */
export function findAncestorNodeIds(
  root: AssemblyTreeNode,
  targetComponentId: string
): string[] {
  const ancestors: string[] = [];

  function search(current: AssemblyTreeNode): boolean {
    if (current.componentId === targetComponentId) {
      return true;
    }
    if (current.children && current.children.length > 0) {
      for (const child of current.children) {
        if (search(child)) {
          ancestors.push(current.id);
          return true;
        }
      }
    }
    return false;
  }

  search(root);
  return ancestors;
}

/**
 * Recursively filters an assembly tree by query without mutating the original structure.
 * Keeps matching component nodes along with all their ancestor assemblies.
 */
export function filterAssemblyTree(
  node: AssemblyTreeNode,
  query: string
): { matches: boolean; filteredNode: AssemblyTreeNode | null } {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return { matches: true, filteredNode: node };
  }

  const nameMatches = node.name.toLowerCase().includes(normalizedQuery);
  const idMatches = node.componentId?.toLowerCase().includes(normalizedQuery) ?? false;
  const selfMatches = nameMatches || idMatches;

  if (!node.children || node.children.length === 0) {
    return {
      matches: selfMatches,
      filteredNode: selfMatches ? node : null,
    };
  }

  const matchingChildren: AssemblyTreeNode[] = [];
  for (const child of node.children) {
    const childResult = filterAssemblyTree(child, normalizedQuery);
    if (childResult.matches && childResult.filteredNode) {
      matchingChildren.push(childResult.filteredNode);
    }
  }

  if (selfMatches || matchingChildren.length > 0) {
    return {
      matches: true,
      filteredNode: {
        ...node,
        // If self matches, keep all original children; if only children matched, keep matching subset
        children: selfMatches ? node.children : matchingChildren,
      },
    };
  }

  return { matches: false, filteredNode: null };
}

/**
 * Collects all node IDs in an assembly tree that have defaultExpanded set to true or are assemblies.
 */
export function collectDefaultExpandedNodeIds(node: AssemblyTreeNode): string[] {
  const ids: string[] = [];
  function recurse(n: AssemblyTreeNode) {
    if (n.defaultExpanded || n.type === 'assembly' || n.type === 'subassembly') {
      ids.push(n.id);
    }
    if (n.children && n.children.length > 0) {
      for (const child of n.children) {
        recurse(child);
      }
    }
  }
  recurse(node);
  return ids;
}
