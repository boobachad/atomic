export interface CanvasTheme {
  id: string;
  name: string;
  background: string;
  /** Node color at connectivity=0 (peripheral) */
  nodeMin: [number, number, number];
  /** Node color at connectivity=1 (hub) */
  nodeMax: [number, number, number];
  /** Edge color at weight=0 (weak) */
  edgeMin: [number, number, number];
  /** Edge color at weight=1 (strong) */
  edgeMax: [number, number, number];
  /** Cluster label text color */
  labelColor: string;
  /** Cluster label pill background */
  labelBg: string;
  /** Cluster label pill border */
  labelBorder: string;
  /** Sigma node label color */
  nodeLabelColor: string;
}

function lerp(a: [number, number, number], b: [number, number, number], t: number): string {
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

export function nodeColor(theme: CanvasTheme, connectivity: number): string {
  return lerp(theme.nodeMin, theme.nodeMax, connectivity);
}

export function edgeColor(theme: CanvasTheme, weight: number): string {
  return lerp(theme.edgeMin, theme.edgeMax, weight);
}

export const CANVAS_THEMES: CanvasTheme[] = [
  {
    id: 'ember',
    name: 'Ember',
    background: '#1a1816',
    nodeMin: [170, 110, 70],
    nodeMax: [230, 50, 40],
    edgeMin: [45, 30, 25],
    edgeMax: [160, 60, 40],
    labelColor: 'rgb(200, 175, 155)',
    labelBg: 'rgb(24, 20, 18)',
    labelBorder: 'rgba(140, 100, 70, 0.3)',
    nodeLabelColor: '#b0a090',
  },
  {
    id: 'steel-violet',
    name: 'Steel Violet',
    background: '#1a1a1a',
    nodeMin: [100, 115, 175],
    nodeMax: [130, 50, 230],
    edgeMin: [30, 30, 45],
    edgeMax: [80, 65, 160],
    labelColor: 'rgb(160, 175, 200)',
    labelBg: 'rgb(22, 22, 22)',
    labelBorder: 'rgba(80, 100, 140, 0.3)',
    nodeLabelColor: '#8899b0',
  },
  {
    id: 'aurora',
    name: 'Aurora',
    background: '#141a1a',
    nodeMin: [60, 160, 140],
    nodeMax: [140, 60, 220],
    edgeMin: [25, 40, 38],
    edgeMax: [70, 100, 150],
    labelColor: 'rgb(155, 200, 190)',
    labelBg: 'rgb(18, 22, 22)',
    labelBorder: 'rgba(70, 140, 130, 0.3)',
    nodeLabelColor: '#88b0a8',
  },
  {
    id: 'midnight',
    name: 'Midnight',
    background: '#12141c',
    nodeMin: [70, 90, 150],
    nodeMax: [100, 140, 255],
    edgeMin: [25, 28, 50],
    edgeMax: [55, 80, 170],
    labelColor: 'rgb(150, 170, 210)',
    labelBg: 'rgb(16, 18, 26)',
    labelBorder: 'rgba(70, 90, 150, 0.3)',
    nodeLabelColor: '#7088b0',
  },
  {
    id: 'monochrome',
    name: 'Mono',
    background: '#181818',
    nodeMin: [100, 100, 100],
    nodeMax: [220, 220, 220],
    edgeMin: [35, 35, 35],
    edgeMax: [100, 100, 100],
    labelColor: 'rgb(180, 180, 180)',
    labelBg: 'rgb(20, 20, 20)',
    labelBorder: 'rgba(100, 100, 100, 0.3)',
    nodeLabelColor: '#909090',
  },
];

export const DEFAULT_THEME = CANVAS_THEMES.find(t => t.id === 'steel-violet')!;
