import { useEffect, useState } from 'react';
import {
  createDefaultPersistenceStatus,
  isPersistenceStatus,
  PERSISTENCE_STATUS_EVENT,
  type PersistenceStatus,
} from '@shared/persistence/persistenceStatus';

/**
 * Persistence status for the official Web App + PWA runtime.
 *
 * The hook is fully typed through the shared persistence contract and has
 * no runtime dependency on native or vendor-specific shells: it starts
 * from the neutral local-only default and listens for typed status updates
 * on the shared persistence channel. Payloads that do not match the shared
 * contract are ignored.
 */
export function usePersistenceStatus(): PersistenceStatus {
  const [status, setStatus] = useState<PersistenceStatus>(() => createDefaultPersistenceStatus());

  useEffect(() => {
    const handleStatusChange = (event: Event) => {
      const { detail } = event as CustomEvent<unknown>;
      if (isPersistenceStatus(detail)) {
        setStatus(detail);
      }
    };

    window.addEventListener(PERSISTENCE_STATUS_EVENT, handleStatusChange);
    return () => window.removeEventListener(PERSISTENCE_STATUS_EVENT, handleStatusChange);
  }, []);

  return status;
}
