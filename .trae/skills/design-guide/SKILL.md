---
name: design-guide
description: Modern UI design system ensuring clean, professional interfaces. Use when creating ANY UI component, webpage, React component, HTML artifact, design mockup, or interface element. Provides design principles for spacing, colors, typography, shadows, and interactive states to prevent cluttered, inconsistent, or unprofessional designs.
---

# Design Guide

This skill ensures every UI component follows modern design principles for clean, professional interfaces.

## Core Design Principles

### 1. Clean and Minimal
- Embrace white space - don't fill every pixel
- Each element should have breathing room
- Remove unnecessary decorative elements
- Let content breathe

### 2. Color Palette
**Base colors:**
- Use grays (#F9FAFB, #F3F4F6, #E5E7EB, #D1D5DB, #9CA3AF, #6B7280, #4B5563, #374151, #1F2937, #111827)
- Use off-whites for backgrounds (#FAFAFA, #F5F5F5)
- Pure white (#FFFFFF) for cards and elevated surfaces

**Accent color:**
- Choose ONE accent color for the entire interface
- Use sparingly for CTAs, links, and key interactive elements
- Good choices: teal (#14B8A6), emerald (#10B981), blue (#3B82F6), indigo (#6366F1), rose (#F43F5E)
- NEVER use generic purple/blue gradients

**Color usage rules:**
- 90% neutral (grays/whites)
- 10% accent color
- Maximum 3-4 colors total in the interface

### 3. Spacing System (8px Grid)
Always use multiples of 8:
- **8px**: Tight spacing (icon-to-text, chip padding)
- **16px**: Standard spacing (between related elements, button padding)
- **24px**: Medium spacing (between form fields, card padding)
- **32px**: Large spacing (between sections)
- **48px**: Extra large spacing (major section breaks)
- **64px**: Maximum spacing (page-level separation)

**Never use**: 10px, 15px, 20px, or arbitrary values

### 4. Typography
**Hierarchy:**
- H1: 32-48px, font-weight: 700
- H2: 24-32px, font-weight: 600
- H3: 20-24px, font-weight: 600
- Body: 16px (minimum), font-weight: 400
- Small text: 14px, font-weight: 400
- Labels: 12-14px, font-weight: 500, uppercase optional

**Font rules:**
- Maximum 2 font families
- Use system fonts when possible (e.g., -apple-system, sans-serif)
- Never use less than 16px for body text
- Line height: 1.5 for body, 1.2 for headings

### 5. Shadows
Use subtle, layered shadows:
- **Light shadow**: `box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1)`
- **Medium shadow**: `box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1)`
- **Heavy shadow** (use rarely): `box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1)`

**Never use:**
- Heavy shadows (> 0.2 opacity)
- Colored shadows
- Multiple shadows on the same element

### 6. Rounded Corners
Be selective and consistent:
- **Buttons**: 8px or 6px
- **Cards**: 12px or 8px
- **Inputs**: 6px or 4px
- **Pills/Badges**: 999px (fully rounded)

**Not everything needs rounded corners** - mix rounded and sharp elements intentionally

### 7. Interactive States
Every interactive element needs:
- **Hover**: Subtle background change or slight scale (1.02)
- **Active**: Slightly darker/pressed appearance
- **Disabled**: 40% opacity, no pointer events
- **Focus**: Clear outline (2px accent color, 2px offset)

## Component Patterns

### Buttons
```
✓ GOOD:
- Padding: 12px 24px (vertical horizontal)
- Font size: 16px
- Border radius: 8px
- Background: Solid accent color
- Hover: Darken by 10%
- Shadow: 0 1px 3px rgba(0,0,0,0.1)
- No gradients

✗ BAD:
- Tiny padding (4px 8px)
- Gradient backgrounds
- Heavy shadows
- Unclear hover state
```

### Cards
```
✓ GOOD:
- Border: 1px solid #E5E7EB OR subtle shadow (not both)
- Padding: 24px
- Border radius: 12px
- Background: white
- Spacing between cards: 24px

✗ BAD:
- Both border AND heavy shadow
- Inconsistent padding
- Multiple border colors
```

### Forms
```
✓ GOOD:
- Label: 14px, font-weight: 500, margin-bottom: 8px
- Input: 16px text, padding: 12px 16px, border: 1px solid #D1D5DB
- Spacing between fields: 24px
- Error state: red border (2px #EF4444), error text below (14px #EF4444)
- Focus state: accent color border, slight glow

✗ BAD:
- Missing labels
- Tiny input text (<16px)
- No clear error states
- Inconsistent spacing (10px, 15px, 20px)
```

### Navigation
```
✓ GOOD:
- Clean horizontal or vertical layout
- Active state clearly indicated (bold text or accent color background)
- Adequate padding (16px vertical, 24px horizontal)
- Hover state distinct from active

✗ BAD:
- Unclear which page is active
- Cramped spacing
- Too many colors
```

## Anti-Patterns to Avoid

1. **Rainbow gradients** - Stick to solid colors
2. **Everything is a different color** - Use 1 accent color
3. **Tiny unreadable text** - 16px minimum
4. **Inconsistent spacing** - Use 8px grid system
5. **Heavy drop shadows** - Keep shadows subtle
6. **Over-rounding** - Not everything needs border-radius
7. **No hover states** - Always provide feedback
8. **Cluttered layouts** - Embrace white space

## Mobile-First Thinking

When building interfaces:
1. Start with mobile layout (320px-768px)
2. Ensure touch targets are minimum 44px
3. Stack elements vertically on mobile
4. Use responsive spacing (smaller gaps on mobile)
5. Ensure text remains readable (never below 16px on mobile)

## Quick Reference

**Spacing scale**: 8, 16, 24, 32, 48, 64px
**Body text**: 16px minimum
**Max fonts**: 2
**Accent colors**: Use 1 only
**Shadow opacity**: ≤ 0.1
**Button padding**: 12px 24px
**Card padding**: 24px
**Form field spacing**: 24px
**Border radius**: 4-12px (buttons/cards), 999px (pills)

## Usage Pattern

Before creating any UI component:
1. Choose ONE accent color (no gradients)
2. Plan spacing using 8px grid
3. Ensure text is ≥16px for body content
4. Add subtle shadows (≤0.1 opacity)
5. Define all interactive states (hover, active, disabled, focus)
6. Use white space generously
7. Verify mobile responsiveness