import React from 'react';
import { VirtualCursor, type VirtualCursorProps } from './VirtualCursor';

export type DwellCursorProps = VirtualCursorProps;

/**
 * DwellCursor (Phase 5 / Task 5.2)
 * Unifies with VirtualCursor (Task 4.3) to provide a single glowing laser pointer
 * wrapped by an animated circular dwell timer.
 */
export const DwellCursor: React.FC<DwellCursorProps> = (props) => {
  return <VirtualCursor {...props} />;
};

export default DwellCursor;
