import { getPopupTitle } from './title';
import './popup.css';

export function App() {
  return (
    <div className="popup">
      <header className="popup__header">
        <span className="popup__badge">Chrome</span>
        <h1 className="popup__title">{getPopupTitle()}</h1>
        <p className="popup__subtitle">Manage your tabs quickly.</p>
      </header>
      <main className="popup__content">
        <button className="primary-button" type="button">
          Open tab manager
        </button>
        <p className="popup__hint">This is a placeholder UI.</p>
      </main>
    </div>
  );
}
