/**
 * Voice-tutor helpers: suggested questions and the parts a teaching step shows. Pure functions;
 * every name comes from the loaded model.
 */

/**
 * Suggested questions in English, built from the loaded model and the selected part (real names
 * only). Each one is a phrase the deterministic parser understands; clicking it runs exactly the
 * same path as saying it (only the speech-to-text step is skipped).
 */
export function suggestedQuestions(partName: string | null): string[] {
  return partName
    ? [`Explain the ${partName}`, `What happens if I remove the ${partName}?`, `What is the ${partName} connected to?`]
    : ['How does this model work?', 'Separate the parts', 'Show me the back'];
}

/** Component ids a step shows in the 3D view (its focus / select / highlight / isolate actions). */
export function shownComponentIds(actions: readonly { type: string }[]): string[] {
  const ids: string[] = [];
  for (const a of actions as { type: string; componentId?: string | null; componentIds?: string[] }[]) {
    if (a.type === 'component.highlight') ids.push(...(a.componentIds ?? []));
    else if (['component.focus', 'component.select', 'component.isolate'].includes(a.type) && a.componentId) ids.push(a.componentId);
  }
  return [...new Set(ids)];
}
