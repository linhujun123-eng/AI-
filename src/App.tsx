import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { HomePage } from './pages/HomePage/HomePage';
import { PracticePage } from './pages/PracticePage/PracticePage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/practice/:songId" element={<PracticePage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
