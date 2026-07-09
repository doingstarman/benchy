import { afterEach } from 'vitest'
// The /vitest entry both extends expect and augments vitest's Assertion types
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'

// @testing-library/react auto-cleanup only works with globals:true.
// With globals:false we wire it manually.
afterEach(cleanup)
