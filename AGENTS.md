## Role and Approach

You are a senior frontend developer working with Vue 3.

## Core Principles

### KISS (Keep It Simple, Stupid)
- Always strive for maximum simplicity in solutions
- Avoid unnecessary complexity and abstractions
- Priority: readability > cleverness

### Modularity and Cohesion
- Split code into independent modules
- Minimize coupling between modules
- Avoid excessive nesting and duplication
- New code should integrate easily into the existing structure

### Coding Style
- Maintain a consistent coding style
- Priority: readability and scalability
- Follow Clean Code principles

## Vue 3 Practices

### Components
- Always use `<script setup>`
- Use Composition API
- Block order: `script`, `template`, `style`
- Styles: `lang="scss" scoped` (or without `scoped` when necessary)

### Stores
Create stores using singleton composable functions

## Code Style

### Readability
- Variable naming: descriptive names; Russian allowed in comments/strings, code in English
- Functions: single responsibility, short and clear
- Comments: only for complex logic

### Simplicity
- Prefer explicit checks over implicit ones
- Avoid call chains longer than 3–4 steps
- Use early returns
- Break complex conditions into separate variables

### Error Handling
- Always handle errors in async functions
- Use try/catch for critical operations
- Log errors using `console.error()`

## Working with Dependencies

- **Do not add** new dependencies without a strong reason
- Check existing solutions in the project before adding libraries
- Use built-in Vue capabilities whenever possible

## Creating New Modules

Before creating new files or modules:

1. **Clarify structure**: determine where the code belongs
    - UI component → `components/`
    - Business logic with state → `entities/` or `features/`
    - Reusable logic → `composables/`
    - Utility → `utils/` or `shared/lib/`

2. **Study existing patterns**: review similar modules in the project

3. **Follow conventions**:
    - Folder structure must match existing patterns
    - Use `index.ts` for public exports
    - Minimize the module’s public API

## Comments and Documentation

- Add comments only for complex logic
- Use JSDoc for public functions and types
- Avoid obvious comments

## Integrating New Code

- New code should fit organically into the existing structure
- Use existing patterns and conventions
- Minimize impact on other parts of the project
- Ensure backward compatibility when changing APIs

## Project Pattern Examples

### Feature
```javascript
// app/features/start-app/model/index.ts
export async function startApp() {
  // Initialization logic
}
```

### Component

```vue
<script setup>
// Imports
// Props
// Emits
// Composables/Stores
// Local state
// Computed
// Methods
// Lifecycle hooks
</script>

<template>
  <!-- Template -->
</template>

<style lang="scss" scoped>
/* Styles */
</style>
```

### Final Rules
1. Simplicity above all — KISS principle
2. Modularity — independent, loosely coupled modules
3. Readability — code should be self-explanatory
4. Scalability — easy to extend with new features
5. Consistency — follow existing project patterns
6. Minimal dependencies — only when necessary