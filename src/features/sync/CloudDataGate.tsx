import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { importDatabaseBackup, restoreDatabaseSnapshot } from '@engines/persistence';
import {
  PERSISTENCE_STATUS_EVENT,
  type PersistenceStatus,
} from '@shared/persistence/persistenceStatus';
import {
  SHOWROOM_COMMAND_COMMITTED_EVENT,
  type ShowroomCommandCommitted,
} from '@shared/persistence/cloudCommit';
import { RouteLoadingFallback } from '@app/router/RouteLoadingFallback';
import {
  commitShowroomState,
  fetchShowroomState,
  subscribeToShowroomChanges,
  unsubscribeFromShowroomChanges,
} from './showroomCloudState';
import { reportClientError } from '../observability/clientObservability';

function publishStatus(status: PersistenceStatus): void {
  window.dispatchEvent(new CustomEvent(PERSISTENCE_STATUS_EVENT, { detail: status }));
}

export function CloudDataGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const revisionRef = useRef(0);
  const committingRef = useRef(false);
  const queueRef = useRef(Promise.resolve());

  const hydrate = useCallback(async () => {
    setFailure(null);
    setReady(false);
    publishStatus({ state: 'syncing', message: 'جارٍ تحميل بيانات المعرض…', updatedAt: new Date().toISOString() });
    try {
      const remote = await fetchShowroomState();
      importDatabaseBackup(remote.snapshot);
      revisionRef.current = remote.revision;
      document.documentElement.dataset.cloudCommit = 'ready';
      publishStatus({ state: 'synced', message: 'بيانات المعرض جاهزة.', updatedAt: new Date().toISOString() });
      setReady(true);
    } catch (reason) {
      void reportClientError('cloud.hydrate', reason);
      const message = reason instanceof Error ? reason.message : 'تعذر تحميل بيانات المعرض. تحققي من الإنترنت وحاولي مجددًا.';
      document.documentElement.dataset.cloudCommit = 'error';
      publishStatus({ state: 'error', message, updatedAt: new Date().toISOString(), attempts: 1 });
      setFailure(message);
    }
  }, []);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    const handleCommit = (event: Event) => {
      const detail = (event as CustomEvent<ShowroomCommandCommitted>).detail;
      if (!detail) return;
      queueRef.current = queueRef.current.then(async () => {
        committingRef.current = true;
        publishStatus({ state: 'syncing', message: 'جارٍ حفظ العملية…', updatedAt: new Date().toISOString() });
        try {
          revisionRef.current = await commitShowroomState({
            expectedRevision: revisionRef.current,
            snapshot: detail.after,
            idempotencyKey: detail.idempotencyKey,
            commandName: detail.commandName,
          });
          document.documentElement.dataset.cloudCommit = 'ready';
          publishStatus({ state: 'synced', message: 'تم حفظ العملية بنجاح.', updatedAt: new Date().toISOString() });
        } catch (reason) {
          void reportClientError('cloud.commit', reason);
          restoreDatabaseSnapshot(detail.before);
          const message = reason instanceof Error ? reason.message : 'تعذر حفظ العملية. لم يُسجل أي تغيير.';
          document.documentElement.dataset.cloudCommit = 'error';
          publishStatus({ state: 'error', message, updatedAt: new Date().toISOString(), attempts: 1 });
          setFailure(message);
          setReady(false);
          await hydrate();
        } finally {
          committingRef.current = false;
        }
      });
    };
    window.addEventListener(SHOWROOM_COMMAND_COMMITTED_EVENT, handleCommit);
    return () => window.removeEventListener(SHOWROOM_COMMAND_COMMITTED_EVENT, handleCommit);
  }, [hydrate]);

  useEffect(() => {
    if (!ready) return undefined;
    const channel = subscribeToShowroomChanges(() => {
      if (!committingRef.current) void hydrate();
    });
    return () => { void unsubscribeFromShowroomChanges(channel); };
  }, [hydrate, ready]);

  if (failure || !ready) {
    return (
      <div className="min-h-screen bg-slate-50" dir="rtl">
        {failure ? (
          <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 p-6 text-center">
            <h1 className="text-2xl font-black text-slate-950">تم إيقاف التشغيل لحماية البيانات</h1>
            <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 font-bold text-red-900">{failure}</p>
            <button type="button" onClick={() => void hydrate()} className="rounded-xl bg-slate-950 px-5 py-3 font-bold text-white">إعادة المحاولة</button>
          </main>
        ) : <RouteLoadingFallback />}
      </div>
    );
  }

  return <>{children}</>;
}
