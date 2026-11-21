import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router';
import { AuthPage } from './pages/AuthPage';
import { FileGate, NotFound } from './pages/FileGate';
import { Home } from './pages/Home';
import { AuthProvider, RequireAuth } from './auth';
import { ToastProvider } from './components/Toast';
import { FullPageSpinner } from './components/ui';
import { useFile } from './lib/useFile';
import { fileUrl } from './lib/util';
import { ThemeProvider } from './theme';

const DocPage = lazy(() => import('./docs/DocPage'));
const CodePage = lazy(() => import('./code/CodePage'));
const WorkspacePage = lazy(() => import('./loop/WorkspacePage'));
const ComponentPage = lazy(() => import('./loop/ComponentPage'));

/** `/f/:id` opens any file in the right editor. */
function OpenFile() {
  const { id = '' } = useParams();
  const state = useFile(id);
  return <FileGate state={state} expect={[]}>{(file) => <Navigate to={fileUrl(file)} replace />}</FileGate>;
}

function Preload() {
  // Warm up the editors in the background once the home page has rendered.
  useEffect(() => {
    const timer = setTimeout(() => {
      void import('./docs/DocPage');
      void import('./code/CodePage');
    }, 1500);
    return () => clearTimeout(timer);
  }, []);
  return null;
}

export function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <Suspense fallback={<FullPageSpinner />}>
              <Routes>
                <Route path="/login" element={<AuthPage mode="login" />} />
                <Route path="/register" element={<AuthPage mode="register" />} />
                <Route element={<RequireAuth />}>
                  <Route
                    path="/"
                    element={
                      <>
                        <Home />
                        <Preload />
                      </>
                    }
                  />
                  <Route path="/d/:id" element={<DocPage />} />
                  <Route path="/code/:id" element={<CodePage />} />
                  <Route path="/w/:id" element={<WorkspacePage />} />
                  <Route path="/w/:id/:pageId" element={<WorkspacePage />} />
                  <Route path="/c/:id" element={<ComponentPage />} />
                  <Route path="/f/:id" element={<OpenFile />} />
                  <Route path="*" element={<NotFound message="This page does not exist." />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
