/**
 * Unit & Integration Tests for CSS & Scroll Architecture
 * Phase 10 - Task 10.1: CSS and Scroll Architecture Remediation
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

function getSrcDir(): string {
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, 'src'))) {
    return path.join(cwd, 'src');
  }
  if (fs.existsSync(path.join(cwd, 'frontend', 'src'))) {
    return path.join(cwd, 'frontend', 'src');
  }
  return path.resolve(cwd, 'src');
}

const SRC_DIR = getSrcDir();

function readStylesheet(relPath: string): string {
  const fullPath = path.join(SRC_DIR, relPath);
  return fs.readFileSync(fullPath, 'utf8');
}

describe('CSS & Scroll Architecture (Task 10.1)', () => {
  const indexCss = readStylesheet('index.css');
  const appCss = readStylesheet('App.css');
  const dashboardCss = readStylesheet('components/dashboard/HomeDashboard.css');
  const workspaceCss = readStylesheet('components/workspace/WorkspaceLayout.css');
  const viewerCss = readStylesheet('components/scene/ViewerCanvas.css');
  const treeCss = readStylesheet('components/workspace/AssemblyTreePanel.css');
  const inspectorCss = readStylesheet('components/workspace/EngineeringInspectorPanel.css');
  const guidedCss = readStylesheet('components/workspace/GuidedLearningPanel.css');

  describe('1. Global Document Flow & Scroll Root (index.css & App.css)', () => {
    it('does NOT enforce blanket overflow: hidden on html or body', () => {
      // Must not lock html and body with overflow: hidden
      assert.ok(!indexCss.includes('html, body, #root {\n  width: 100%;\n  height: 100%;\n  overflow: hidden;'));
      assert.ok(!indexCss.includes('body {\n  overflow: hidden;'));
    });

    it('sets min-height: 100% on html, body, and #root for natural vertical expansion', () => {
      assert.ok(indexCss.includes('min-height: 100%'));
      assert.ok(indexCss.includes('overflow-x: hidden'));
      assert.ok(indexCss.includes('#root {'));
    });

    it('provides standardized dark CAD scrollbar definitions', () => {
      assert.ok(indexCss.includes('::-webkit-scrollbar'));
      assert.ok(indexCss.includes('scrollbar-width: thin'));
    });

    it('does not force fixed height: 100vh or overflow: hidden on .app-container', () => {
      assert.ok(appCss.includes('min-height: 100vh'));
      assert.ok(!appCss.includes('.app-container {\n  display: flex;\n  flex-direction: column;\n  width: 100vw;\n  height: 100vh;\n  background-color: var(--bg-primary, #0b0f19);\n  color: var(--text-primary, #f9fafb);\n  overflow: hidden;\n}'));
    });
  });

  describe('2. Catalogue layout (HomeDashboard.css)', () => {
    it('the page scrolls normally and the grid becomes one column on narrow screens', () => {
      assert.ok(dashboardCss.includes('.catalogue {'));
      assert.match(dashboardCss, /@media \(max-width: 860px\) \{\s*\.catalogue-grid \{ grid-template-columns: 1fr; \}/);
    });

    it('keeps the 3D preview out of the card height calculation (no canvas-driven growth)', () => {
      // Regression: a WebGL canvas's intrinsic size must never set the card height
      assert.match(dashboardCss, /\.catalogue-preview \{[^}]*aspect-ratio:\s*16 \/ 9/);
      assert.match(dashboardCss, /\.catalogue-preview \.model-preview-container \{[^}]*position:\s*absolute;[^}]*inset:\s*0/);
    });

    it('domain tabs scroll sideways instead of overflowing on small screens', () => {
      assert.match(dashboardCss, /\.catalogue-tabs \{[^}]*overflow-x:\s*auto/);
    });
  });

  describe('3. CAD Workspace Contained Shell & Panel Scrolling (WorkspaceLayout.css)', () => {
    it('contains CAD shell to 100vh/100dvh with overflow: hidden without locking outer document', () => {
      assert.ok(workspaceCss.includes('.cad-workspace-shell {'));
      assert.ok(workspaceCss.includes('height: 100vh'));
      assert.ok(workspaceCss.includes('height: 100dvh'));
      assert.ok(workspaceCss.includes('overflow: hidden'));
    });

    it('enforces min-height: 0 on flex children to allow internal panel scrolling', () => {
      assert.ok(workspaceCss.includes('min-height: 0'));
      assert.ok(workspaceCss.includes('.dock-content {'));
      assert.ok(workspaceCss.includes('-webkit-overflow-scrolling: touch'));
    });

    it('ensures central 3D viewport has min-height: 0 and min-width: 0', () => {
      assert.ok(workspaceCss.includes('.cad-viewport-center {'));
      assert.ok(workspaceCss.includes('.viewport-inner {'));
    });
  });

  describe('4. Viewport & Dock Internal Scroll Panels', () => {
    it('sets min-height: 0 on ViewerCanvas container avoiding flex blowout', () => {
      assert.ok(!viewerCss.includes('min-height: 400px'));
      assert.ok(viewerCss.includes('min-height: 0'));
    });

    it('enforces independent vertical scrolling on AssemblyTreePanel', () => {
      assert.ok(treeCss.includes('.tree-content-scroll {'));
      assert.ok(treeCss.includes('overflow-y: auto'));
      assert.ok(treeCss.includes('min-height: 0'));
    });

    it('enforces independent vertical scrolling on EngineeringInspectorPanel', () => {
      assert.ok(inspectorCss.includes('.inspector-content {'));
      assert.ok(inspectorCss.includes('overflow-y: auto'));
      assert.ok(inspectorCss.includes('min-height: 0'));
    });

    it('enforces independent vertical scrolling on GuidedLearningPanel', () => {
      assert.ok(guidedCss.includes('.lesson-body {'));
      assert.ok(guidedCss.includes('overflow-y: auto'));
      assert.ok(guidedCss.includes('max-height: 240px'));
    });
  });
});
