import { createRoot } from 'react-dom/client';

import { ManagerApp } from './ManagerApp';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(<ManagerApp />);
