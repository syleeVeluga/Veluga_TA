import React, { createContext, useContext, useEffect, useState } from 'react';
import type { PolicyContext } from '../../shared-types/src/index.js';

const PolicyContextReact = createContext<PolicyContext | null>(null);

export function PolicyProvider({
  initialPolicy,
  children
}: {
  initialPolicy: PolicyContext;
  children: React.ReactNode;
}) {
  const [policy, setPolicy] = useState(initialPolicy);
  useEffect(() => initialPolicy.subscribe(setPolicy), [initialPolicy]);
  return <PolicyContextReact.Provider value={policy}>{children}</PolicyContextReact.Provider>;
}

export function usePolicyContext(): PolicyContext {
  const policy = useContext(PolicyContextReact);
  if (!policy) {
    throw new Error('usePolicyContext must be used inside PolicyProvider');
  }
  return policy;
}
