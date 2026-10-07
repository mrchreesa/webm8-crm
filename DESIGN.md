---
version: alpha
name: WebM8 CRM
description: A quiet lead desk with a pine navigation rail and an outcome pathway.
colors:
  primary: '#173c35'
  background: '#f3f6f7'
  surface: '#ffffff'
  text: '#172f2c'
  muted: '#465b57'
  border: '#dce5e3'
  success: '#25634a'
  warning: '#8b570c'
  danger: '#a83240'
  accent: '#f0be9b'
typography:
  display:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif'
  body:
    fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, Arial, sans-serif'
  mono:
    fontFamily: 'ui-monospace, monospace'
rounded:
  DEFAULT: '0.625rem'
  panel: '0.875rem'
spacing:
  section: '1.5rem'
  page: '2.5rem'
components:
  button:
    backgroundColor: '{colors.primary}'
    textColor: '{colors.surface}'
  panel:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.text}'
---

# WebM8 CRM Design System

## Overview

The reference is a small business owner's lead desk: contact records on the left, the next useful action on the right. This is a product surface for a UK business, in English, used daily on a laptop and occasionally a phone. The signature is an outcome pathway: independent milestone bars express what leads actually reached, including skipped stages. Avoid marketing hero sections, fabricated growth charts, and campaign-manager density.

## Colors

Pine anchors navigation and actions; cool grey surrounds white working surfaces. Peach marks the brand monogram only. Semantic text labels accompany success, warning, and danger colours. Light theme only; system colours remain operable in forced-colour mode.

## Typography

Use the operating system UI font for headings and body: SF on Apple devices, Segoe UI on Windows, with Arial/sans-serif fallbacks. Body text is 16px at default browser settings; working rows are 15px, labels 14px and supporting captions at least 13px. Runtime tokens `--text-body`, `--text-ui`, `--text-label` and `--text-caption` use rem units so browser text preferences apply. Headings use restrained 600–700 weights and less compressed tracking. Secondary text uses #465b57 for stronger contrast. Mobile inputs stay at 16px; labels do not shrink at breakpoints. Tabular numbers align counts and amounts. Monospace is reserved for IDs. No font download is required.

## Layout

A 224px navigation rail and a natural document scroller. Main content has 40px desktop padding and a 1440px maximum width. At 1000px the rail narrows and paired panels stack; at 680px navigation becomes a horizontal labelled strip and padding becomes 18px. Tables own horizontal overflow. Forms keep natural height. The default Lead desk uses a 300px lead queue beside the record, narrowing to 260px on smaller laptops. Only the queue list has a bounded internal scroll; the record uses document scrolling. At 900px and below, selecting a lead shows the record with a Back to leads link. Filters and search remain mounted. Record history, qualification and source data use native disclosures. Amber distinguishes possible visit matches.

## Elevation & Depth

Borders define working surfaces. Static panels use no shadow. Only dialogs and notifications have elevation. No gradients or ornamental animations.

## Shapes

10px controls and 14px panels soften the operational content. Badges are small pill labels. Lucide icons use consistent 1.7px strokes.

## Components

CRM and Analytics tabs share a compact header with workspace context, using existing primary, surface, muted, track and radius tokens. CRM remains mounted while Analytics is visible; the report owns its internal scrolling. Desktop and mobile share text/icons, a filled selected state and keyboard focus. No new palette or typography is introduced.

Runtime ownership is `src/styles.css`: `colors.*` mirrors `--color-*`, typography mirrors `--font-*`, radius mirrors `--radius-*`, spacing mirrors `--space-*`. Shared primitives in `src/ui.tsx` consume those variables. Tokens are maintained together and checked by `npm run test`.

Buttons distinguish primary, outline, ghost and danger. Focus is a visible 3px outline. Disabled/busy controls retain dimensions. Shared fields own inline errors and labels. Native select and date popups deliberately retain platform behaviour; product date-time conversion always uses Europe/London. Dialog uses native `showModal()` for inertness, focus containment, Escape and focus restoration. Shared notifications use a polite live region; actionable errors stay in forms. Motion is limited to a short spinner and hover feedback and respects reduced motion.

Copy names real actions. API delivery is always “Accepted by Meta”. Counts have no invented spend, attribution or matching metrics. GBP and en-GB formatting are canonical.

## Do's and Don'ts

- Do keep the next follow-up visible and distinguish synthetic records everywhere.
- Do use the same stage and delivery badges across screens.
- Don't imply stage bars are nested: skipped milestones are not filled in.
- Don't describe accepted API events as matched, attributed or optimization active.
