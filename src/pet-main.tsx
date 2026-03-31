import React from 'react';
import ReactDOM from 'react-dom/client';
import { DesktopPetApp } from './pet/DesktopPetApp';
import './styles/pet.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <DesktopPetApp />
  </React.StrictMode>,
);
