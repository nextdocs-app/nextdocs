# Design tokens and naming

Tokens describe intent, not appearance. A component asks for `text.muted`, not for gray 500.

## Naming

`category.role.variant`. Categories are `color`, `space`, `radius`, `type`, `shadow`, and `motion`. A variant is a state such as `hover` or `pressed`, never a number.

## Color

Every color has a light and a dark value. A token without a dark value inherits the light value and is flagged in review.

- `color.surface.default`
- `color.surface.raised`
- `color.text.default`
- `color.text.muted`
- `color.border.subtle`
- `color.accent.default`

## Spacing

The scale is 4, 8, 12, 16, 24, 32, 48, 64. Components may not use a value outside the scale without a documented exception.

## Type

Three sizes for body, three for headings, one monospace. Line height is a multiple of four.

## Review

A new token needs a screenshot in light and dark, and a name that a new engineer can guess without opening the file.

> A token name should explain why a value exists, not the color or size it happens to use.

| Token                   | Light value | Dark value | Purpose              |
| ----------------------- | ----------- | ---------- | -------------------- |
| `color.surface.default` | `#ffffff`   | `#17191d`  | Main page background |
| `color.text.muted`      | `#626975`   | `#a7adb8`  | Secondary labels     |

## Review checklist

- [ ] The token has a semantic name.
- [ ] Light and dark values meet contrast guidance.
- [ ] A component example is included in the pull request.

```css
.status-label {
  color: var(--color-text-muted);
  border-radius: var(--radius-control);
}
```
