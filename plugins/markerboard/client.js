import { socketMethods } from './client/socketMethods.js';
import { lifecycleMethods } from './client/lifecycleMethods.js';
import { documentMethods } from './client/documentMethods.js';
import { persistenceMethods } from './client/persistenceMethods.js';
import { uiMethods } from './client/uiMethods.js';
import { renderMethods } from './client/renderMethods.js';

function makeClientId() {
  try {
    const key = 'markerboard-client-id';
    const existing = window.localStorage.getItem(key);
    if (existing) return existing;
    const created = `mb-${Math.random().toString(36).slice(2, 10)}`;
    window.localStorage.setItem(key, created);
    return created;
  } catch {
    return `mb-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const markerboardPlugin = {
  name: 'markerboard',
  priority: 95,
  context: null,
  deck: null,
  deckEventsBound: false,
  overlayRoot: null,
  canvas: null,
  ctx: null,
  toolbar: null,
  hiddenByOverview: false,
  repaintTimerIds: [],
  transitionFadeOutTimer: null,
  transitionFadeInTimer: null,
  socketPath: '/presenter-plugins-socket',
  appendEmitBatchMs: 30,
  pluginSocket: null,
  pluginSocketConnected: false,
  pluginSocketRoomId: '',
  pluginSocketJoinPending: false,
  pendingAppendEmits: new Map(),
  appendEmitFlushTimer: null,
  seenOpIds: new Set(),
  lastRemoteSnapshotAt: 0,
  socketDebug: true,
  activePointerId: null,
  activeStrokeId: null,
  strokeCounter: 0,
  opCounter: 0,
  clientId: makeClientId(),
  selectedTool: 'pen',
  selectedColor: 'rgba(255,59,48,0.95)',
  toolButtons: {},
  colorButtons: {},
  widthSlider: null,
  widthValueLabel: null,
  saveMenuEl: null,
  saveMenuOutsideHandler: null,
  clearMenuEl: null,
  clearMenuOutsideHandler: null,
  undoHistory: {},
  toolPresets: {
    pen: {
      width: 4,
      maxWidth: 50,
      compositeMode: 'source-over'
    },
    highlighter: {
      width: 40,
      maxWidth: 200,
      compositeMode: 'source-over'
    },
    eraser: {
      width: 60,
      maxWidth: 200,
      compositeMode: 'destination-out'
    }
  },
  colorPalette: [
    'rgba(255,59,48,0.95)',
    'rgba(255,149,0,0.95)',
    'rgba(255,214,10,0.95)',
    'rgba(52,199,89,0.95)',
    'rgba(0,122,255,0.95)',
    'rgba(175,82,222,0.95)',
    'rgba(255,255,255,0.95)',
    'rgba(0,0,0,0.95)'
  ],
  tool: {
    color: 'rgba(255,59,48,0.95)',
    width: 4,
    compositeMode: 'source-over',
    tool: 'pen'
  },
  state: {
    enabled: false
  },
  doc: {
    docId: 'presentation:unknown',
    version: 1,
    coordinateSpace: {
      unit: 'slide',
      width: 960,
      height: 700,
      allowOutOfBounds: true
    },
    slides: {},
    opLog: []
  }
};

Object.assign(
  markerboardPlugin,
  socketMethods,
  lifecycleMethods,
  documentMethods,
  persistenceMethods,
  uiMethods,
  renderMethods
);

window.RevelationPlugins = window.RevelationPlugins || {};
window.RevelationPlugins.markerboard = markerboardPlugin;
