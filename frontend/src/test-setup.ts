import { expect, afterEach } from 'vitest'
import * as matchers from '@testing-library/jest-dom/matchers'
import { cleanup } from '@testing-library/react'

expect.extend(matchers)

// @testing-library/react auto-cleanup only works with globals:true.
// With globals:false we wire it manually.
afterEach(cleanup)
