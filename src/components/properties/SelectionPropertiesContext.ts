import { createContext } from 'react';
/** Selection semantics only; rows and editors remain the ordinary property UI. */
export const SelectionPropertiesContext = createContext<string[] | null>(null);
