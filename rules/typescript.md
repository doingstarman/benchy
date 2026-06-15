# TypeScript Rules

## Strictness

- `strict: true` in tsconfig — no exceptions
- No `any`. If you think you need it, use `unknown` and narrow with guards
- No `as unknown as X` double-cast tricks
- No `@ts-ignore` or `@ts-expect-error` without a comment explaining why the type system is wrong

## Exports

- Named exports only — no `export default`
- Re-export from barrel files only when genuinely useful; prefer direct imports

## Async

- `async/await` everywhere — no raw `.then()` / `.catch()` chains
- Never `new Promise()` unless wrapping a callback API with no alternative
- Errors are always `unknown` in catch blocks — narrow with `instanceof Error` before accessing `.message`

## Types

- Define types in `src/types.ts` (shared) or co-located in the module if truly local
- Union types over enums: `type Status = 'pending' | 'running' | 'done' | 'error'`
- `interface` for object shapes, `type` for unions and aliases
- Integer timestamps in milliseconds (`number`) — no `Date` objects in DB/API layer

## Modules

- ESM throughout (`"type": "module"` in package.json, `"module": "NodeNext"` in tsconfig)
- Import paths must include `.js` extension (NodeNext resolution): `import { foo } from './foo.js'`
- `import type` for type-only imports

## What not to do

```typescript
// ❌
const x: any = foo()
const y = bar as unknown as MyType
export default function handler() {}
.then(r => r.json()).catch(e => console.error(e))

// ✅
const x: MyType = foo()
if (!(x instanceof MyType)) throw new Error('...')
export function handler() {}
const r = await fetch(url); const data = await r.json()
```
