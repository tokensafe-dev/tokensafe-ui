import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

function App() {
  const [probes, setProbes] = useState(0);
  useEffect(() => {
    let done = false;
    const register = () => {
      if (done) return;
      if (window.__OUMV_REACT__) {
        done = true;
        window.__OUMV_REACT__.registerStore(
          'certificationProbe',
          () => ({ probes }),
          { 'conformance-probe': () => setProbes((value) => value + 1) }
        );
        // One real request produces a real L4 trace.
        fetch('/api/stats').catch(() => {});
        return;
      }
      setTimeout(register, 50);
    };
    register();
  }, [probes]);

  return (
    <main>
      <h1>OUMV certification app</h1>
      <button data-agent-id="probe-btn" onClick={() => setProbes((value) => value + 1)}>
        Probe {probes}
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
