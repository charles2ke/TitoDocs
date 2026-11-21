import { ChartNoAxesGantt, ListTodo, MessageCircleQuestionMark, Pilcrow, Vote, type LucideIcon } from 'lucide-react';
import type { ComponentType } from '@shared/types';

export interface ComponentTypeInfo {
  label: string;
  description: string;
  icon: LucideIcon;
  keywords: string[];
}

/** The kinds of Loop components, in the order they are offered. */
export const COMPONENT_TYPES: Record<ComponentType, ComponentTypeInfo> = {
  tasks: {
    label: 'Task list',
    description: 'Tasks with owners and due dates',
    icon: ListTodo,
    keywords: ['todo', 'checklist', 'action items', 'loop'],
  },
  progress: {
    label: 'Progress tracker',
    description: 'Track the status of work items',
    icon: ChartNoAxesGantt,
    keywords: ['status', 'tracker', 'kanban', 'loop'],
  },
  voting: {
    label: 'Voting table',
    description: 'Let people vote on ideas',
    icon: Vote,
    keywords: ['poll', 'vote', 'decision', 'loop'],
  },
  qna: {
    label: 'Q&A',
    description: 'Collect and answer questions',
    icon: MessageCircleQuestionMark,
    keywords: ['questions', 'answers', 'faq', 'qna', 'loop'],
  },
  rich: {
    label: 'Paragraph',
    description: 'Live rich text you can share anywhere',
    icon: Pilcrow,
    keywords: ['text', 'notes', 'rich text', 'loop'],
  },
};

export const COMPONENT_ORDER = Object.keys(COMPONENT_TYPES) as ComponentType[];

export const componentInfo = (type: ComponentType | null | undefined): ComponentTypeInfo => COMPONENT_TYPES[type ?? 'rich'] ?? COMPONENT_TYPES.rich;
