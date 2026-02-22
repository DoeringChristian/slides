import type { Slide } from '../types/presentation';
import { createSlide, createTextElement } from '../utils/slideFactory';

export interface SlideLayout {
  name: string;
  create: () => Slide;
}

export const LAYOUTS: SlideLayout[] = [
  {
    name: 'Blank',
    create: () => createSlide(),
  },
  {
    name: 'Title Slide',
    create: () => {
      const title = createTextElement({
        x: 80, y: 160, width: 800, height: 80,
        text: 'Presentation Title',
        style: { fontFamily: 'Arial', fontSize: 44, fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none', color: '#202124', align: 'center', verticalAlign: 'middle', lineHeight: 1.2 },
      });
      const subtitle = createTextElement({
        x: 160, y: 260, width: 640, height: 40,
        text: 'Subtitle goes here',
        style: { fontFamily: 'Arial', fontSize: 20, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', color: '#5f6368', align: 'center', verticalAlign: 'middle', lineHeight: 1.2 },
      });
      const slide = createSlide();
      slide.elements = { [title.id]: title, [subtitle.id]: subtitle };
      slide.elementOrder = [title.id, subtitle.id];
      return slide;
    },
  },
  {
    name: 'Title + Content',
    create: () => {
      const title = createTextElement({
        x: 60, y: 30, width: 840, height: 50,
        text: 'Slide Title',
        style: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none', color: '#202124', align: 'left', verticalAlign: 'middle', lineHeight: 1.2 },
      });
      const content = createTextElement({
        x: 60, y: 100, width: 840, height: 380,
        text: 'Content goes here\n\n• Point one\n• Point two\n• Point three',
        style: { fontFamily: 'Arial', fontSize: 20, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', color: '#333333', align: 'left', verticalAlign: 'top', lineHeight: 1.5 },
      });
      const slide = createSlide();
      slide.elements = { [title.id]: title, [content.id]: content };
      slide.elementOrder = [title.id, content.id];
      return slide;
    },
  },
  {
    name: 'Two Column',
    create: () => {
      const title = createTextElement({
        x: 60, y: 30, width: 840, height: 50,
        text: 'Slide Title',
        style: { fontFamily: 'Arial', fontSize: 32, fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none', color: '#202124', align: 'left', verticalAlign: 'middle', lineHeight: 1.2 },
      });
      const left = createTextElement({
        x: 60, y: 100, width: 400, height: 380,
        text: 'Left column content',
        style: { fontFamily: 'Arial', fontSize: 18, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', color: '#333333', align: 'left', verticalAlign: 'top', lineHeight: 1.5 },
      });
      const right = createTextElement({
        x: 500, y: 100, width: 400, height: 380,
        text: 'Right column content',
        style: { fontFamily: 'Arial', fontSize: 18, fontWeight: 'normal', fontStyle: 'normal', textDecoration: 'none', color: '#333333', align: 'left', verticalAlign: 'top', lineHeight: 1.5 },
      });
      const slide = createSlide();
      slide.elements = { [title.id]: title, [left.id]: left, [right.id]: right };
      slide.elementOrder = [title.id, left.id, right.id];
      return slide;
    },
  },
  {
    name: 'Section Header',
    create: () => {
      const title = createTextElement({
        x: 80, y: 200, width: 800, height: 80,
        text: 'Section Title',
        style: { fontFamily: 'Arial', fontSize: 48, fontWeight: 'bold', fontStyle: 'normal', textDecoration: 'none', color: '#4285f4', align: 'center', verticalAlign: 'middle', lineHeight: 1.2 },
      });
      const slide = createSlide();
      slide.elements = { [title.id]: title };
      slide.elementOrder = [title.id];
      return slide;
    },
  },
];
