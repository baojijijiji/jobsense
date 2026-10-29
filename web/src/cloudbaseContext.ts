import { createContext } from 'react'
import type { Account } from './cloudbaseAccount'

export const CloudAccountContext = createContext<Account | null>(null)
