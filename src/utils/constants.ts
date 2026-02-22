export const SLIDE_WIDTH = 960;
export const SLIDE_HEIGHT = 540;
export const THUMBNAIL_SCALE = 0.19;
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 3;
export const DEFAULT_ZOOM = 1;
export const GRID_SIZE = 20;
export const CANVAS_PADDING = 100;
export const TEXT_BOX_PADDING = 8; // Inner padding for text elements

export const DEFAULT_TEXT_STYLE = {
  fontFamily: 'Arial',
  fontSize: 24,
  fontWeight: 'normal' as const,
  fontStyle: 'normal' as const,
  textDecoration: 'none' as const,
  color: '#333333',
  align: 'left' as const,
  verticalAlign: 'top' as const,
  lineHeight: 1.2,
};

export const DEFAULT_SHAPE_PROPS = {
  fill: '#4285f4',
  stroke: '#2962ff',
  strokeWidth: 0,
  cornerRadius: 0,
};

export const PRESET_COLORS = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#ff0000', '#ff6600', '#ffcc00', '#33cc33', '#3399ff', '#9933ff',
  '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#6fa8dc', '#8e7cc3',
  '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#3d85c6', '#674ea7',
  '#990000', '#b45f06', '#bf9000', '#38761d', '#0b5394', '#351c75',
  '#4285f4', '#ea4335', '#fbbc04', '#34a853', '#ff6d01', '#46bdc6',
];

export const FONT_FAMILIES = [
  'Arial',
  'Helvetica',
  'Times New Roman',
  'Georgia',
  'Courier New',
  'Verdana',
  'Trebuchet MS',
  'Impact',
  'Comic Sans MS',
  'Palatino',
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 56, 64, 72, 96];
