// File: dashboard/src/App.tsx
import React from 'react';
import { BrowserRouter as Router, Routes, Route, Link } from 'react-router-dom';
import PriceBand from './pages/PriceBand';

export default function App() {
  return (
    <Router>
      <div className="p-4">
        <nav className="mb-4">
          <ul className="flex space-x-4">
            <li><Link to="/" className="text-xl font-medium">Dashboard Home</Link></li>
            <li><Link to="/price-band" className="text-xl font-medium">Price Band</Link></li>
          </ul>
        </nav>
        <Routes>
          <Route path="/" element={<div>Welcome to the Guaso Coin Dashboard</div>} />
          <Route path="/price-band" element={<PriceBand />} />
        </Routes>
      </div>
    </Router>
  );
}
