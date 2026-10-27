// Chausar playbook kit: the idea pipeline's shapes (Ink v2 wave 5, package 5A3), on 4J18's venture-idea records.
// Package 5-0 named them; 5A3 replaces the placeholders here, never in contracts.ts. Types only. Written for Chausar;
// nothing here is learned from an outside source.

/** The stages an idea moves through, forward only, or to dropped with a reason. */
export type IdeaStage = 'inbox' | 'triage' | 'drafted' | 'made' | 'published' | 'dropped';
/** The owner's grade seven days after an idea was published. */
export type IdeaGrade = 'worked' | 'so-so' | 'did-not';
/** venture.ideas.add's answer. */
export type IdeaAddedView = { placeholder: true };
/** venture.ideas.move's answer. */
export type IdeaMovedView = { placeholder: true };
/** venture.ideas.grade's answer. */
export type IdeaGradedView = { placeholder: true };
