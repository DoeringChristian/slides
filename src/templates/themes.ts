import type { Theme } from '../types/presentation';

export const THEMES: Theme[] = [
  {
    name: 'Light',
    colors: { primary: '#4285f4', secondary: '#5f6368', accent: '#ea4335', background: '#ffffff', text: '#333333', heading: '#202124' },
    fonts: { heading: 'Arial', body: 'Arial' },
  },
  {
    name: 'Dark',
    colors: { primary: '#8ab4f8', secondary: '#9aa0a6', accent: '#f28b82', background: '#202124', text: '#e8eaed', heading: '#ffffff' },
    fonts: { heading: 'Arial', body: 'Arial' },
  },
  {
    name: 'Corporate',
    colors: { primary: '#1a73e8', secondary: '#174ea6', accent: '#d93025', background: '#f8f9fa', text: '#3c4043', heading: '#1a237e' },
    fonts: { heading: 'Georgia', body: 'Arial' },
  },
  {
    name: 'Minimalist',
    colors: { primary: '#000000', secondary: '#666666', accent: '#ff4081', background: '#fafafa', text: '#212121', heading: '#000000' },
    fonts: { heading: 'Helvetica', body: 'Helvetica' },
  },
  {
    name: 'Nature',
    colors: { primary: '#2e7d32', secondary: '#558b2f', accent: '#ff8f00', background: '#f1f8e9', text: '#33691e', heading: '#1b5e20' },
    fonts: { heading: 'Georgia', body: 'Verdana' },
  },
  {
    name: 'Ocean',
    colors: { primary: '#0277bd', secondary: '#01579b', accent: '#00bcd4', background: '#e1f5fe', text: '#01579b', heading: '#006064' },
    fonts: { heading: 'Trebuchet MS', body: 'Arial' },
  },
  {
    name: 'Sunset',
    colors: { primary: '#e65100', secondary: '#bf360c', accent: '#ff6f00', background: '#fff3e0', text: '#4e342e', heading: '#bf360c' },
    fonts: { heading: 'Georgia', body: 'Verdana' },
  },
  {
    name: 'Royal',
    colors: { primary: '#4a148c', secondary: '#6a1b9a', accent: '#ffd600', background: '#f3e5f5', text: '#4a148c', heading: '#311b92' },
    fonts: { heading: 'Palatino', body: 'Georgia' },
  },
  {
    name: 'Monochrome',
    colors: { primary: '#424242', secondary: '#616161', accent: '#9e9e9e', background: '#fafafa', text: '#212121', heading: '#000000' },
    fonts: { heading: 'Courier New', body: 'Courier New' },
  },
];
