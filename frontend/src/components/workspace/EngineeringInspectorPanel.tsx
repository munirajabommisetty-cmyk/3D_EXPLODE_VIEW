import React, { useState, useEffect, useCallback, useId } from 'react';
import { Icon } from '../ui/Icon';
import type {
  EngineeringComponentMetadata,
  MechanicalComponentMetadata,
  CivilComponentMetadata,
  MedicalComponentMetadata,
} from '../../types/engineering';
import type { EngineeringModelDefinition } from '../../types/models';
import { resolveInspectorMetadata, formatRoleTitle } from '../../utils/inspectorUtils';
import './EngineeringInspectorPanel.css';

export type InspectorTab = 'overview' | 'specifications' | 'materials';

export interface EngineeringInspectorPanelProps {
  /** Explicit component metadata to display (takes priority if provided) */
  metadata?: EngineeringComponentMetadata | null;
  /** Component ID to resolve from activeModel or registry */
  componentId?: string | null;
  /** Active engineering model definition to resolve component metadata */
  activeModel?: EngineeringModelDefinition | null;
  /** Callback to close the inspector or deselect the component */
  onClose: () => void;
  /** Optional container class name */
  className?: string;
  /** Optional initial tab to display (defaults to 'overview') */
  initialTab?: InspectorTab;
  /** Ask the voice tutor something about this part (same path as speaking it). */
  onAskTutor?: (request: string) => void;
}

/**
 * Reusable metadata row item (omits rendering entirely if value is undefined, null, or empty string)
 */
export const MetadataRow: React.FC<{
  label: string;
  value: React.ReactNode | null | undefined;
  unit?: string;
  className?: string;
}> = ({ label, value, unit, className = '' }) => {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  return (
    <div className={`metadata-row ${className}`}>
      <span className="metadata-label">{label}</span>
      <span className="metadata-value">
        {value}
        {unit ? ` ${unit}` : ''}
      </span>
    </div>
  );
};

/**
 * General-Purpose Engineering Inspector Panel (Task 9.6)
 * Schema-driven inspector rendering multi-tabbed technical metadata for both
 * mechanical and civil engineering components.
 */
export const EngineeringInspectorPanel: React.FC<EngineeringInspectorPanelProps> = ({
  metadata: propMetadata,
  componentId,
  activeModel,
  onClose,
  className = '',
  initialTab = 'overview',
  onAskTutor,
}) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>(initialTab);
  const panelId = useId();

  // Resolve metadata dynamically
  const metadata = resolveInspectorMetadata(propMetadata, componentId, activeModel);

  // Keyboard shortcut listener: Escape closes the inspector
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  // Tab key navigation (ArrowLeft / ArrowRight)
  const handleTabKeyDown = (e: React.KeyboardEvent, currentTab: InspectorTab) => {
    const tabs: InspectorTab[] = ['overview', 'specifications', 'materials'];
    const currentIndex = tabs.indexOf(currentTab);

    if (e.key === 'ArrowRight') {
      e.preventDefault();
      const nextTab = tabs[(currentIndex + 1) % tabs.length];
      setActiveTab(nextTab);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const prevTab = tabs[(currentIndex - 1 + tabs.length) % tabs.length];
      setActiveTab(prevTab);
    }
  };

  // 1. Empty State: No component selected
  if (!metadata && !componentId) {
    return (
      <aside
        className={`engineering-inspector-panel empty ${className}`}
        aria-label="Engineering Component Inspector (No Selection)"
      >
        <div className="inspector-empty-placeholder">
          <span className="empty-icon" aria-hidden="true">
            <Icon name="target" size={28} strokeWidth={1.6} />
          </span>
          <h3 className="empty-title">No Component Selected</h3>
          <p className="empty-description">
            Hover with the virtual laser pointer and dwell for 1.2s, or left-click
            any part in the 3D viewport or assembly tree to inspect engineering
            specifications.
          </p>
          {onAskTutor && (
            <div className="inspector-tutor-card">
              <h4 className="card-section-title">Voice tutor</h4>
              <p className="empty-description">
                Select a part, then tap the mic (or press M) and ask “Explain this part”. You can also say
                “Show the back” or “Zoom in”, in English, తెలుగు or हिन्दी.
              </p>
              <button type="button" className="tutor-ask-btn" onClick={() => onAskTutor('explain how this model works')}>
                <Icon name="cap" size={15} /> Explain this model
              </button>
            </div>
          )}
          <div className="empty-hint-list">
            <div className="hint-row">
              <span className="hint-bullet" aria-hidden="true">
                <Icon name="pointer" size={14} />
              </span>
              <span>Point at component to target</span>
            </div>
            <div className="hint-row">
              <span className="hint-bullet" aria-hidden="true">
                <Icon name="clock" size={14} />
              </span>
              <span>Hold steady for 1.2s dwell</span>
            </div>
            <div className="hint-row">
              <span className="hint-bullet" aria-hidden="true">
                <Icon name="mouse" size={14} />
              </span>
              <span>Or click directly on component</span>
            </div>
          </div>
        </div>
      </aside>
    );
  }

  // 2. Fallback: Component ID provided but metadata unavailable
  if (!metadata && componentId) {
    return (
      <aside
        className={`engineering-inspector-panel fallback ${className}`}
        aria-label="Engineering Component Inspector"
      >
        <div className="inspector-header">
          <div className="header-info">
            <h2 className="component-title">{componentId}</h2>
            <span className="id-badge">ID: {componentId}</span>
          </div>
          <button
            type="button"
            className="inspector-close-btn"
            onClick={onClose}
            title="Deselect component [Esc]"
            aria-label="Close component inspector"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div className="inspector-content">
          <div className="inspector-alert-box">
            <span className="alert-icon" aria-hidden="true">
              <Icon name="alert" size={16} />
            </span>
            <p>Component metadata unavailable for &quot;{componentId}&quot;.</p>
          </div>
        </div>
      </aside>
    );
  }

  // Safe non-null assertion: metadata is verified above
  const comp = metadata as EngineeringComponentMetadata;
  const isMechanical = comp.domain === 'mechanical';
  const isCivil = comp.domain === 'civil';
  const mechanical = isMechanical ? (comp as MechanicalComponentMetadata) : null;
  const civil = isCivil ? (comp as CivilComponentMetadata) : null;
  // Anatomy modules (Human Eye Explorer): anatomy facts instead of engineering parameters
  const anatomy = comp.domain === 'medical' ? (comp as MedicalComponentMetadata) : null;

  // Filter material-specific specifications if present
  const materialSpecs = comp.specifications?.filter((spec) => {
    const label = spec.label?.toLowerCase() || '';
    return (
      label.includes('material') ||
      label.includes('alloy') ||
      label.includes('hardness') ||
      label.includes('treatment') ||
      label.includes('yield') ||
      label.includes('tensile') ||
      label.includes('grade')
    );
  });

  const hasMaterialData = Boolean(
    (comp.materialName && comp.materialName.trim() !== '') ||
      (civil && civil.materialGrade && civil.materialGrade.trim() !== '') ||
      (materialSpecs && materialSpecs.length > 0)
  );

  return (
    <aside
      className={`engineering-inspector-panel ${className}`}
      aria-label="Engineering Component Inspector"
    >
      {/* 1. Header Bar with Name, ID Badge, and Close Button */}
      <div className="inspector-header">
        <div className="header-info">
          <div className="header-top-row">
            <span
              className={`domain-pill ${comp.domain}`}
              title={`Engineering Discipline: ${comp.domain}`}
            >
              {comp.domain === 'mechanical' ? 'Mechanical' : comp.domain === 'medical' ? 'Anatomy' : 'Civil'}
            </span>
            <span className="id-badge" title={`Unique component ID: ${comp.id}`}>
              ID: {comp.id}
            </span>
          </div>
          <h2 className="component-title" title={comp.name}>
            {comp.name}
          </h2>
          {comp.role && (
            <span className="component-subtitle" title={comp.role}>
              {comp.role}
            </span>
          )}
        </div>
        <button
          type="button"
          className="inspector-close-btn"
          onClick={onClose}
          title="Deselect component [Esc]"
          aria-label="Close component inspector"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      {/* Ask the voice tutor about this part (same path as speaking the request) */}
      {onAskTutor && (
        <div className="inspector-tutor-row" role="group" aria-label={`Ask the tutor about ${comp.name}`}>
          <span className="tutor-row-label">Ask the tutor</span>
          <button type="button" className="tutor-ask-btn primary" onClick={() => onAskTutor(`explain the ${comp.name}`)}><Icon name="cap" size={14} /> Explain</button>
          <button type="button" className="tutor-ask-btn" onClick={() => onAskTutor(`why is the ${comp.name} needed`)}>Why is it needed?</button>
          <button type="button" className="tutor-ask-btn" onClick={() => onAskTutor(`how does the ${comp.name} work`)}>How does it work?</button>
          {/* Anatomy: no "what if it fails" (that would invite medical speculation); ask about connections instead */}
          {comp.domain === 'medical'
            ? <button type="button" className="tutor-ask-btn" onClick={() => onAskTutor(`show the parts connected to the ${comp.name}`)}>What is it connected to?</button>
            : <button type="button" className="tutor-ask-btn" onClick={() => onAskTutor(`what happens if the ${comp.name} fails`)}>What if it fails?</button>}
        </div>
      )}

      {/* 2. Tab Navigation Bar */}
      <nav
        className="inspector-tablist"
        role="tablist"
        aria-label="Component Information Tabs"
      >
        <button
          type="button"
          role="tab"
          id={`${panelId}-tab-overview`}
          aria-selected={activeTab === 'overview'}
          aria-controls={`${panelId}-panel-overview`}
          tabIndex={activeTab === 'overview' ? 0 : -1}
          className={`tab-btn ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
          onKeyDown={(e) => handleTabKeyDown(e, 'overview')}
        >
          Overview
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-tab-specifications`}
          aria-selected={activeTab === 'specifications'}
          aria-controls={`${panelId}-panel-specifications`}
          tabIndex={activeTab === 'specifications' ? 0 : -1}
          className={`tab-btn ${activeTab === 'specifications' ? 'active' : ''}`}
          onClick={() => setActiveTab('specifications')}
          onKeyDown={(e) => handleTabKeyDown(e, 'specifications')}
        >
          Specifications
        </button>
        <button
          type="button"
          role="tab"
          id={`${panelId}-tab-materials`}
          aria-selected={activeTab === 'materials'}
          aria-controls={`${panelId}-panel-materials`}
          tabIndex={activeTab === 'materials' ? 0 : -1}
          className={`tab-btn ${activeTab === 'materials' ? 'active' : ''}`}
          onClick={() => setActiveTab('materials')}
          onKeyDown={(e) => handleTabKeyDown(e, 'materials')}
        >
          Materials
        </button>
      </nav>

      {/* 3. Tab Panels */}
      <div className="inspector-content">
        {/* Tab 1: Overview */}
        {activeTab === 'overview' && (
          <div
            id={`${panelId}-panel-overview`}
            role="tabpanel"
            aria-labelledby={`${panelId}-tab-overview`}
            className="tab-panel overview-panel"
          >
            {/* Description Card */}
            {comp.description && (
              <div className="inspector-card">
                <h4 className="card-section-title">Functional Description</h4>
                <p className="description-text">{comp.description}</p>
              </div>
            )}

            {/* Quick Summary Card */}
            <div className="inspector-card">
              <h4 className="card-section-title">System Identification</h4>
              <div className="metadata-table">
                <MetadataRow label="Component Name" value={comp.name} />
                <MetadataRow label="Part ID" value={comp.id} />
                <MetadataRow
                  label="Discipline"
                  value={comp.domain === 'mechanical' ? 'Mechanical Engineering' : comp.domain === 'medical' ? 'Neuroanatomy (learning model)' : 'Civil Engineering'}
                />
                <MetadataRow label="Functional Role" value={comp.role} />
                {comp.assemblyRole && (
                  <MetadataRow
                    label="Assembly Role"
                    value={formatRoleTitle(comp.assemblyRole)}
                  />
                )}
                {civil?.structuralRole && (
                  <MetadataRow
                    label="Structural Position"
                    value={formatRoleTitle(civil.structuralRole)}
                  />
                )}
              </div>
            </div>

            {/* Component Relationships (Phase 10) */}
            {comp.relationships && comp.relationships.length > 0 && (
              <div className="inspector-card">
                <h4 className="card-section-title">Component Relationships</h4>
                <div className="relation-root" aria-hidden="true">{comp.name}</div>
                <ul className="relation-map" aria-label={`How the ${comp.name} connects to other parts`}>
                  {comp.relationships.map((rel, index) => {
                    const targetName = activeModel?.getComponentMetadata(rel.targetComponentId)?.name ?? rel.targetComponentId;
                    return (
                      <li key={`rel-${index}-${rel.targetComponentId}`} className="relation-row">
                        <span className="relation-type">{formatRoleTitle(rel.relationshipType)}</span>
                        <span className="relation-node" title={`${targetName} (${rel.targetComponentId})`}>{targetName}</span>
                        {rel.description && <span className="relation-desc">{rel.description}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {/* Engineering & Educational Notes */}
            {((comp.engineeringNotes && comp.engineeringNotes.length > 0) ||
              (civil?.educationalNotes && civil.educationalNotes.length > 0)) && (
              <div className="inspector-card">
                <h4 className="card-section-title">
                  {isCivil ? 'Educational Notes' : anatomy ? 'Key Facts' : 'Engineering Notes'}
                </h4>
                <ul className="notes-list">
                  {comp.engineeringNotes?.map((note, index) => (
                    <li key={`eng-note-${index}`} className="note-item">
                      {note}
                    </li>
                  ))}
                  {civil?.educationalNotes?.map((note, index) => (
                    <li key={`edu-note-${index}`} className="note-item">
                      {note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Specifications */}
        {activeTab === 'specifications' && (
          <div
            id={`${panelId}-panel-specifications`}
            role="tabpanel"
            aria-labelledby={`${panelId}-tab-specifications`}
            className="tab-panel specifications-panel"
          >
            {/* Anatomy: where it is, whether it is an atlas mesh or a simplified shape, learning-only notice */}
            {anatomy && (
              <div className="inspector-card">
                <h4 className="card-section-title">Anatomy</h4>
                <MetadataRow label="Location" value={anatomy.region === 'external' ? 'Visible from outside' : 'Inside'} />
                <MetadataRow label="Model" value={anatomy.representation === 'simplified' ? 'Simplified educational shape (not in the atlas file)' : 'Reference-atlas mesh'} />
                <MetadataRow label="Atlas meshes" value={anatomy.atlasStructures.length ? String(anatomy.atlasStructures.length) : null} />
                {anatomy.networkNote && <p className="description-text">{anatomy.networkNote}</p>}
                <p className="description-text">Learning model of normal anatomy (HuBMAP Human Reference Atlas). Not medical advice.</p>
              </div>
            )}

            {/* Mechanical Kinematics & Sizing Section */}
            {mechanical && (
              <div className="inspector-card">
                <h4 className="card-section-title">Kinematics &amp; Geometry</h4>
                <div className="metadata-table">
                  <MetadataRow label="Nominal Speed" value={mechanical.nominalRpm} />
                  <MetadataRow label="Gear Ratio" value={mechanical.gearRatio} />
                  <MetadataRow
                    label="Teeth Count"
                    value={mechanical.teethCount !== undefined ? `${mechanical.teethCount} teeth` : null}
                  />
                  <MetadataRow label="Pitch Diameter" value={mechanical.pitchDiameter} />
                  <MetadataRow label="Module Pitch" value={mechanical.modulePitch} />
                  <MetadataRow label="Torque Rating" value={mechanical.torqueRating} />
                  <MetadataRow label="Lubrication" value={mechanical.lubricationSpec} />
                  <MetadataRow
                    label="Service Interval"
                    value={
                      mechanical.serviceIntervalHours !== undefined
                        ? `${mechanical.serviceIntervalHours.toLocaleString()} hrs`
                        : null
                    }
                  />
                </div>
              </div>
            )}

            {/* Civil Structural Analysis Annotations Section */}
            {civil && (
              <div className="inspector-card">
                <div className="card-header-with-badge">
                  <h4 className="card-section-title">Structural Design Annotations</h4>
                  <span className="edu-badge" title="Qualitative educational reference, not live FEA">
                    Educational Spec
                  </span>
                </div>
                <div className="metadata-table">
                  <MetadataRow
                    label="Structural Member"
                    value={civil.structuralRole ? formatRoleTitle(civil.structuralRole) : null}
                  />
                  <MetadataRow
                    label="Nominal Force"
                    value={civil.nominalForceType ? formatRoleTitle(civil.nominalForceType) : null}
                  />
                  <MetadataRow label="Design Load Ref" value={civil.designLoadAnnotation} />
                  <MetadataRow label="Material Grade" value={civil.materialGrade} />
                  <MetadataRow label="Span / Length" value={civil.spanLength} />
                  <MetadataRow label="Slenderness Ref" value={civil.slendernessAnnotation} />
                </div>
                {civil.educationalNotes && civil.educationalNotes.length > 0 && (
                  <div className="spec-notes-box">
                    <span className="spec-notes-label">Educational Notes:</span>
                    <ul className="notes-list">
                      {civil.educationalNotes.map((note, index) => (
                        <li key={`spec-edu-note-${index}`} className="note-item">
                          {note}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}

            {/* Extended Technical Specifications Key-Value Array */}
            {comp.specifications && comp.specifications.length > 0 && (
              <div className="inspector-card">
                <h4 className="card-section-title">Technical Parameters</h4>
                <div className="metadata-table">
                  {comp.specifications.map((spec, index) => (
                    <MetadataRow
                      key={`spec-${index}`}
                      label={spec.label}
                      value={spec.value}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Empty state if component has no technical specs */}
            {!mechanical && !civil && (!comp.specifications || comp.specifications.length === 0) && (
              <div className="tab-empty-box">
                <p className="tab-empty-text">No technical specifications recorded for this component.</p>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: Materials */}
        {activeTab === 'materials' && (
          <div
            id={`${panelId}-panel-materials`}
            role="tabpanel"
            aria-labelledby={`${panelId}-tab-materials`}
            className="tab-panel materials-panel"
          >
            {hasMaterialData ? (
              <>
                {/* Primary Material Specification */}
                <div className="inspector-card">
                  <h4 className="card-section-title">Material Specification</h4>
                  <div className="metadata-table">
                    <MetadataRow label="Designated Material" value={comp.materialName} />
                    {civil?.materialGrade && (
                      <MetadataRow label="Structural Grade" value={civil.materialGrade} />
                    )}
                  </div>
                </div>

                {/* Additional Material & Treatment Specifications */}
                {materialSpecs && materialSpecs.length > 0 && (
                  <div className="inspector-card">
                    <h4 className="card-section-title">Mechanical &amp; Surface Properties</h4>
                    <div className="metadata-table">
                      {materialSpecs.map((spec, index) => (
                        <MetadataRow
                          key={`mat-spec-${index}`}
                          label={spec.label}
                          value={spec.value}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              /* Clear Materials Empty State */
              <div className="tab-empty-box">
                <span className="tab-empty-icon" aria-hidden="true">
                  <Icon name="flask" size={24} strokeWidth={1.6} />
                </span>
                <h4 className="tab-empty-title">No Material Data Available</h4>
                <p className="tab-empty-text">
                  This component does not specify alloy composition, metallurgical
                  treatment, or material grade properties.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};

export default EngineeringInspectorPanel;
