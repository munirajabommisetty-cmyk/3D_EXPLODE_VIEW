import React, { useState, useMemo, useCallback } from 'react';
import type { AssemblyTreeNode } from '../../types/models';
import {
  getDescendantComponentIds,
  findAncestorNodeIds,
  filterAssemblyTree,
  collectDefaultExpandedNodeIds,
} from '../../utils/assemblyTreeUtils';
import './AssemblyTreePanel.css';

export interface AssemblyTreePanelProps {
  /** Root hierarchical CAD assembly tree node */
  rootNode: AssemblyTreeNode | null | undefined;
  /** Currently selected component ID (if any) */
  selectedComponentId: string | null;
  /** Callback when a component node is selected */
  onSelectComponent: (componentId: string | null) => void;
  /** Set of component IDs currently hidden in the 3D viewport */
  hiddenComponentIds: Set<string>;
  /** Callback to toggle visibility for a node (component or assembly) */
  onToggleVisibility: (node: AssemblyTreeNode) => void;
  /** Optional container class name */
  className?: string;
}

interface TreeNodeRowProps {
  node: AssemblyTreeNode;
  depth: number;
  selectedComponentId: string | null;
  hiddenComponentIds: Set<string>;
  isExpanded: boolean;
  onToggleExpand: (nodeId: string) => void;
  isNodeExpanded: (nodeId: string) => boolean;
  onSelectComponent: (componentId: string | null) => void;
  onToggleVisibility: (node: AssemblyTreeNode) => void;
}

/**
 * Individual row renderer for an AssemblyTreeNode with recursive children.
 */
const TreeNodeRow: React.FC<TreeNodeRowProps> = ({
  node,
  depth,
  selectedComponentId,
  hiddenComponentIds,
  isExpanded,
  onToggleExpand,
  isNodeExpanded,
  onSelectComponent,
  onToggleVisibility,
}) => {
  const hasChildren = Boolean(node.children && node.children.length > 0);
  const isComponent = node.type === 'component';
  const isSelected = isComponent && node.componentId === selectedComponentId;

  // Determine visibility state
  const descendantIds = useMemo(() => getDescendantComponentIds(node), [node]);
  const isVisible = useMemo(() => {
    if (isComponent && node.componentId) {
      return !hiddenComponentIds.has(node.componentId);
    }
    if (descendantIds.length === 0) return true;
    return !descendantIds.every((id) => hiddenComponentIds.has(id));
  }, [isComponent, node.componentId, descendantIds, hiddenComponentIds]);

  const handleRowClick = () => {
    if (isComponent && node.componentId) {
      if (isSelected) {
        onSelectComponent(null);
      } else {
        onSelectComponent(node.componentId);
      }
    } else if (hasChildren) {
      onToggleExpand(node.id);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleRowClick();
    } else if (e.key === 'ArrowRight' && hasChildren && !isExpanded) {
      e.preventDefault();
      onToggleExpand(node.id);
    } else if (e.key === 'ArrowLeft' && hasChildren && isExpanded) {
      e.preventDefault();
      onToggleExpand(node.id);
    }
  };

  return (
    <div className="tree-node-group" role="group">
      <div
        className={`tree-node-row ${node.type} ${isSelected ? 'selected' : ''} ${
          !isVisible ? 'hidden-node' : ''
        }`}
        style={{ paddingLeft: `${depth * 14 + 10}px` }}
        onClick={handleRowClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? isExpanded : undefined}
        aria-label={`${node.name} (${node.type})`}
      >
        {/* Caret expand/collapse toggle */}
        {hasChildren ? (
          <button
            type="button"
            className="tree-caret-btn"
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand(node.id);
            }}
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={isExpanded}
          >
            <span className={`caret-icon ${isExpanded ? 'open' : ''}`} aria-hidden="true">
              ▶
            </span>
          </button>
        ) : (
          <span className="tree-leaf-spacer" aria-hidden="true">
            •
          </span>
        )}

        {/* Node Icon */}
        <span className="node-type-icon" aria-hidden="true">
          {node.type === 'assembly' ? '🗂️' : node.type === 'subassembly' ? '📦' : '⚙️'}
        </span>

        {/* Node Label */}
        <span className="node-label" title={node.name}>
          {node.name}
        </span>

        {/* Child Count Pill for assemblies */}
        {hasChildren && (
          <span className="node-children-count" title={`${node.children!.length} sub-units`}>
            {node.children!.length}
          </span>
        )}

        {/* Visibility Toggle Button */}
        <button
          type="button"
          className={`tree-visibility-btn ${isVisible ? 'visible' : 'hidden'}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(node);
          }}
          title={isVisible ? `Hide ${node.name} in 3D viewport` : `Show ${node.name} in 3D viewport`}
          aria-label={isVisible ? `Hide ${node.name} in 3D viewport` : `Show ${node.name} in 3D viewport`}
        >
          <span className="visibility-icon" aria-hidden="true">
            {isVisible ? '👁' : '⊘'}
          </span>
        </button>
      </div>

      {/* Render children if expanded */}
      {hasChildren && isExpanded && (
        <div className="tree-children-container">
          {node.children!.map((child) => (
            <TreeNodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedComponentId={selectedComponentId}
              hiddenComponentIds={hiddenComponentIds}
              isExpanded={isNodeExpanded(child.id)}
              onToggleExpand={onToggleExpand}
              isNodeExpanded={isNodeExpanded}
              onSelectComponent={onSelectComponent}
              onToggleVisibility={onToggleVisibility}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/**
 * Interactive Assembly Hierarchy Tree Panel
 * Task 9.5: Provides collapsible tree navigation, per-component visibility toggling,
 * search filtering with ancestor retention, and bidirectional 3D raycast synchronization.
 */
export const AssemblyTreePanel: React.FC<AssemblyTreePanelProps> = ({
  rootNode,
  selectedComponentId,
  onSelectComponent,
  hiddenComponentIds,
  onToggleVisibility,
  className = '',
}) => {
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [manualExpandedState, setManualExpandedState] = useState<Map<string, boolean>>(new Map());

  // Default expanded node IDs derived from model definition
  const defaultExpandedIds = useMemo(() => {
    return rootNode ? new Set(collectDefaultExpandedNodeIds(rootNode)) : new Set<string>();
  }, [rootNode]);

  // Ancestors of selected component (automatically expanded when selected externally)
  const selectedAncestorIds = useMemo(() => {
    return rootNode && selectedComponentId
      ? new Set(findAncestorNodeIds(rootNode, selectedComponentId))
      : new Set<string>();
  }, [rootNode, selectedComponentId]);

  // Filter tree based on search term
  const { filteredTree, hasFilterMatches } = useMemo(() => {
    if (!rootNode) {
      return { filteredTree: null, hasFilterMatches: false };
    }
    if (!searchTerm.trim()) {
      return { filteredTree: rootNode, hasFilterMatches: true };
    }
    const result = filterAssemblyTree(rootNode, searchTerm);
    return {
      filteredTree: result.filteredNode,
      hasFilterMatches: result.matches && result.filteredNode !== null,
    };
  }, [rootNode, searchTerm]);

  // All matching branch IDs when filtering (auto-expanded during search)
  const searchExpandedIds = useMemo(() => {
    if (!searchTerm.trim() || !filteredTree) return new Set<string>();
    return new Set(collectDefaultExpandedNodeIds(filteredTree));
  }, [searchTerm, filteredTree]);

  // Pure function checking if a node is expanded
  const isNodeExpanded = useCallback(
    (nodeId: string): boolean => {
      // 1. If searching, expand all matching branches
      if (searchTerm.trim().length > 0) {
        return searchExpandedIds.has(nodeId);
      }
      // 2. If node is an ancestor of the currently selected component, keep it expanded
      if (selectedAncestorIds.has(nodeId)) {
        return true;
      }
      // 3. User manual toggle overrides default
      const manual = manualExpandedState.get(nodeId);
      if (manual !== undefined) {
        return manual;
      }
      // 4. Fallback to model's defaultExpanded configuration
      return defaultExpandedIds.has(nodeId);
    },
    [searchTerm, searchExpandedIds, selectedAncestorIds, manualExpandedState, defaultExpandedIds]
  );

  const handleToggleExpand = useCallback(
    (nodeId: string) => {
      setManualExpandedState((prev) => {
        const next = new Map(prev);
        const currentlyExpanded = isNodeExpanded(nodeId);
        next.set(nodeId, !currentlyExpanded);
        return next;
      });
    },
    [isNodeExpanded]
  );

  return (
    <div className={`assembly-tree-panel ${className}`} role="tree" aria-label="Assembly Hierarchy Tree">
      {/* 1. Filter Search Bar */}
      <div className="tree-filter-bar">
        <span className="filter-search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          type="text"
          className="tree-filter-input"
          placeholder="Filter assembly components..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          aria-label="Filter assembly tree components"
        />
        {searchTerm && (
          <button
            type="button"
            className="filter-clear-btn"
            onClick={() => setSearchTerm('')}
            title="Clear search filter"
            aria-label="Clear search filter"
          >
            ✕
          </button>
        )}
      </div>

      {/* 2. Tree Content Area */}
      <div className="tree-content-scroll">
        {!rootNode ? (
          <div className="assembly-tree-empty">
            <span className="empty-icon" aria-hidden="true">
              🗂️
            </span>
            <p className="empty-title">No Assembly Hierarchy</p>
            <p className="empty-desc">
              The active model does not define a CAD assembly tree.
            </p>
          </div>
        ) : !hasFilterMatches || !filteredTree ? (
          <div className="assembly-tree-no-matches">
            <p className="no-matches-text">
              No matching components found for &quot;<strong>{searchTerm}</strong>&quot;
            </p>
            <button
              type="button"
              className="clear-search-action-btn"
              onClick={() => setSearchTerm('')}
            >
              Clear Filter
            </button>
          </div>
        ) : (
          <TreeNodeRow
            node={filteredTree}
            depth={0}
            selectedComponentId={selectedComponentId}
            hiddenComponentIds={hiddenComponentIds}
            isExpanded={isNodeExpanded(filteredTree.id)}
            onToggleExpand={handleToggleExpand}
            isNodeExpanded={isNodeExpanded}
            onSelectComponent={onSelectComponent}
            onToggleVisibility={onToggleVisibility}
          />
        )}
      </div>

      {/* 3. Footer Summary */}
      {rootNode && (
        <div className="tree-footer-info">
          <span className="tree-summary-label">
            {hiddenComponentIds.size > 0
              ? `${hiddenComponentIds.size} hidden part${hiddenComponentIds.size > 1 ? 's' : ''}`
              : 'All components visible'}
          </span>
          {hiddenComponentIds.size > 0 && (
            <button
              type="button"
              className="unhide-all-btn"
              onClick={() => {
                onToggleVisibility(rootNode);
              }}
              title="Show all components in 3D viewport"
            >
              Show All
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default AssemblyTreePanel;
