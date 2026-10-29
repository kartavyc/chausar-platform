// Chausar playbook: Podcast to articles (Ink v2 wave 5, package 5L). The registry entry, with no runtime imports.
// Package 5-0 left it null, so the playbook is not registered and has no tile; the package sets its id
// ('podcast-to-article'), label, service type, picks, summary, risk level and review day (the plan's "Registration"
// line). Written for Chausar; nothing here is learned from an outside source.
import type { PlaybookRegistration } from '../registry.ts';

export const PODCAST_TO_ARTICLE_REGISTRATION: PlaybookRegistration = Object.freeze({id:'podcast-to-article',label:'Podcast to articles',serviceType:'content',picks:['podcast to article','podcast to blog','video to article','episode to blog post','show notes service'],summary:'Agents turn each episode into an article, show notes and a newsletter blurb, every sentence tied to the transcript; you pick the angle and approve the article.',riskLevel:'medium',lastReviewed:'2026-10-28'});
