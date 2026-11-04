import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { AppShell } from './components/AppShell';
import { DialogHost } from './components/dialogs';
import { flushSaves, hasUnsavedChanges, initApp } from './lib/store';
import { Home } from './pages/Home';
import { MapEditorPage } from './pages/MapEditor';

export default function App() {
  useEffect(() => {
    void initApp();
    // Saving happens a moment after an edit. Save at once when the app is hidden or
    // closed, and warn if the window closes before that save is done.
    const onHide = () => {
      if (document.visibilityState === 'hidden') void flushSaves();
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges()) return;
      void flushSaves();
      e.preventDefault();
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  return (
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <AppShell>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/map/:id" element={<MapEditorPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
      <DialogHost />
    </BrowserRouter>
  );
}
