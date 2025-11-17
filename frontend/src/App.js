import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

// Pages
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import TaskImport from './pages/TaskImport';
import Workflows from './pages/Workflows';
import Analytics from './pages/Analytics';
import Users from './pages/Users';
import AIAssistant from './pages/AIAssistant';
import Enterprise from './pages/Enterprise';
import AuditLogs from './pages/AuditLogs';
import Layout from './components/Layout';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      axios.get(`${API}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(res => {
        setUser(res.data);
        setLoading(false);
      })
      .catch(() => {
        localStorage.removeItem('token');
        setLoading(false);
      });
    } else {
      setLoading(false);
    }
  }, []);

  const ProtectedRoute = ({ children }) => {
    if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
    return user ? children : <Navigate to="/login" />;
  };

  const PublicRoute = ({ children }) => {
    if (loading) return <div className="flex items-center justify-center h-screen">Loading...</div>;
    return user ? <Navigate to="/dashboard" /> : children;
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<PublicRoute><Login setUser={setUser} /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register setUser={setUser} /></PublicRoute>} />
        
        <Route path="/" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Dashboard /></Layout></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Dashboard /></Layout></ProtectedRoute>} />
        <Route path="/tasks" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Tasks user={user} /></Layout></ProtectedRoute>} />
        <Route path="/tasks/import" element={<ProtectedRoute><Layout user={user} setUser={setUser}><TaskImport /></Layout></ProtectedRoute>} />
        <Route path="/workflows" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Workflows user={user} /></Layout></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Analytics /></Layout></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Users user={user} /></Layout></ProtectedRoute>} />
        <Route path="/ai" element={<ProtectedRoute><Layout user={user} setUser={setUser}><AIAssistant /></Layout></ProtectedRoute>} />
        <Route path="/enterprise" element={<ProtectedRoute><Layout user={user} setUser={setUser}><Enterprise user={user} /></Layout></ProtectedRoute>} />
        <Route path="/admin/audit-logs" element={<ProtectedRoute><Layout user={user} setUser={setUser}><AuditLogs user={user} /></Layout></ProtectedRoute>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
