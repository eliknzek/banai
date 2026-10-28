// The three ways to start (spec section 6). All of them land in the same editor and data model.
import { TEMPLATES } from '../domain/presets.js';

export const ENTRY_POINTS = Object.freeze([
  Object.freeze({
    id: 'guided',
    icon: 'chat',
    title: 'Guide me',
    description: 'Answer a few questions and the AI designer will propose a wardrobe for you to confirm.',
    action: 'Start guided flow',
    focusesChat: true, // placeholder text per language: chat/i18n.js composerHints.guided
  }),
  Object.freeze({
    id: 'freeText',
    icon: 'edit',
    title: 'Describe it',
    description: 'Type your wardrobe in your own words. The AI designer turns it into a proposal you approve.',
    action: 'Enter description',
    focusesChat: true, // composerHints.freeText
  }),
  Object.freeze({
    id: 'basic',
    icon: 'wardrobe',
    title: 'Start from a basic wardrobe',
    description: 'Begin with a standard 200 × 240 × 60 cm wardrobe, then edit it by hand or with the AI.',
    action: 'Open basic wardrobe',
    focusesChat: false,
  }),
]);

export const getEntryPoint = (id) => ENTRY_POINTS.find((entry) => entry.id === id) ?? null;

// Extra ready-made starting points, shown below the three entry points. Each opens the manual
// editor with a template design (domain/presets.js TEMPLATES) instead of the basic wardrobe.
export const TEMPLATE_ENTRIES = Object.freeze(TEMPLATES.map((template) => Object.freeze({
  id: `template-${template.id}`,
  templateId: template.id,
  title: template.title,
  description: template.description,
  action: 'Use this template',
  focusesChat: false,
})));
