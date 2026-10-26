import React, { useEffect, useCallback } from 'react';
import {
  getComponentMetadata,
  type ExtendedComponentInfo,
} from '../../data/machineMetadata';
import type { MechanicalComponentId } from '../../types/assembly';
import './ComponentInfoPanel.css';

export interface ComponentInfoPanelProps {
  componentId: MechanicalComponentId | null;
  onClose: () => void;
  className?: string;
}

export const ComponentInfoPanel: React.FC<ComponentInfoPanelProps> = ({
  componentId,
  onClose,
  className,
}) => {
  const metadata: ExtendedComponentInfo | null = componentId
    ? getComponentMetadata(componentId)
    : null;

  // Keyboard shortcut listener: Space or Escape to deselect
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const targetTag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (targetTag === 'input' || targetTag === 'textarea') return;

      if (e.key === 'Escape' || e.code === 'Space') {
        e.preventDefault();
        onClose();
      }
    },
    [onClose]
  );

  useEffect(() => {
    if (!componentId) return;
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [componentId, handleKeyDown]);

  if (!componentId) {
    return null;
  }

  return (
    <aside
      className={`component-info-panel ${className || ''}`}
      aria-label="Component Engineering Specifications HUD"
      role="complementary"
    >
      {/* Header bar with component name and close button */}
      <div className="panel-header">
        <div className="panel-title-group">
          <span className="panel-icon">⚙️</span>
          <div>
            <h2 className="panel-title">{metadata?.name || componentId}</h2>
            <span className="panel-subtitle">{metadata?.role || 'Mechanical Component'}</span>
          </div>
        </div>
        <button
          type="button"
          className="panel-close-btn"
          onClick={onClose}
          title="Deselect component [Esc or Space]"
          aria-label="Close component specification panel"
        >
          ✕
        </button>
      </div>

      <div className="panel-body">
        {/* Component Tag and Status Pill */}
        <div className="component-badge-row">
          <span className="component-id-tag">ID: {componentId}</span>
          <span className="component-status-tag active">Selected</span>
        </div>

        {/* Fallback state if metadata is missing */}
        {!metadata && (
          <div className="missing-metadata-alert" role="alert">
            <span className="alert-icon">⚠️</span>
            <p>Detailed engineering specifications are currently unavailable for this part.</p>
          </div>
        )}

        {/* Primary Mechanical Specifications Grid */}
        {metadata && (
          <>
            <section className="specs-section">
              <h3 className="section-title">Kinematics &amp; Dimensions</h3>
              <div className="specs-grid">
                <div className="spec-card">
                  <span className="spec-label">Teeth Count</span>
                  <span className="spec-val">
                    {metadata.teethCount !== undefined ? `${metadata.teethCount} teeth` : 'N/A'}
                  </span>
                </div>
                <div className="spec-card">
                  <span className="spec-label">Nominal Speed</span>
                  <span className="spec-val">{metadata.nominalRpm}</span>
                </div>
                <div className="spec-card">
                  <span className="spec-label">Kinematic Ratio</span>
                  <span className="spec-val">{metadata.gearRatio}</span>
                </div>
                <div className="spec-card">
                  <span className="spec-label">Pitch Diameter</span>
                  <span className="spec-val">{metadata.pitchDiameter}</span>
                </div>
              </div>
            </section>

            {/* Material & Tribology Section */}
            <section className="specs-section">
              <h3 className="section-title">Material &amp; Maintenance</h3>
              <div className="details-list">
                <div className="detail-item">
                  <span className="detail-label">Material:</span>
                  <span className="detail-val">{metadata.materialName}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Lubrication:</span>
                  <span className="detail-val">{metadata.lubricationSpec}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Service Life:</span>
                  <span className="detail-val">
                    Every {metadata.serviceIntervalHours.toLocaleString()} Operating Hours
                  </span>
                </div>
              </div>
            </section>

            {/* Engineering Technical Specifications Table */}
            {metadata.specifications.length > 0 && (
              <section className="specs-section">
                <h3 className="section-title">Technical Specifications</h3>
                <table className="specs-table">
                  <tbody>
                    {metadata.specifications.map((spec) => (
                      <tr key={spec.label}>
                        <td className="spec-table-label">{spec.label}</td>
                        <td className="spec-table-val">{spec.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {/* Engineering Notes & Functional Role */}
            <section className="specs-section">
              <h3 className="section-title">Engineering Description</h3>
              <p className="panel-description">{metadata.description}</p>
              {metadata.engineeringNotes.length > 0 && (
                <ul className="notes-list">
                  {metadata.engineeringNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      {/* Footer Actions */}
      <div className="panel-footer">
        <button
          type="button"
          className="deselect-btn"
          onClick={onClose}
          title="Deselect active component [Space]"
          aria-label="Deselect active component"
        >
          Deselect Component [Space]
        </button>
      </div>
    </aside>
  );
};

export default ComponentInfoPanel;
