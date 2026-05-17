# shadcn Primitives

These files are **shadcn-generated** wrappers around `radix-ui` primitives (lyra variant, zinc base, no border radius).

## Rules

- **Add new primitives via the shadcn MCP** (`mcp__shadcn__*`) or `pnpm dlx shadcn@latest add <name>`. Don't author from scratch — the generator handles variant boilerplate, ARIA, and Tailwind class wiring consistently.
- **Don't add app logic here.** These are display primitives. Compose them in `../<feature>/` (e.g., `../projects/task-card.tsx`) and keep this dir feature-agnostic.
- **Preserve the style choices** when re-adding or updating:
  - No border radius (`rounded-none` is intentional, not an oversight).
  - JetBrains Mono font + zinc palette + dark-mode-only (no `light:` variants needed).
  - Variants use `cva` + `cn()` from `@/lib/utils`; sizes include `xs`, `sm`, `default`, `lg`, `icon`, `icon-xs`.
- **Imports**: `import { Slot } from "radix-ui"` (umbrella package), not `@radix-ui/react-slot`. Match the existing pattern when adding new primitives.
- **Don't edit** a primitive to fix a one-off bug in a consumer. Wrap or compose at the call site instead.

## When the shadcn CLI changes your file

Re-running `add <name>` overwrites. If you've intentionally diverged, capture the divergence in a wrapper component in `../<feature>/` and keep the primitive close to generator output.
